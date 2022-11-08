'use strict'

const Router = require('express').Router
const passport = require('passport')
const validator = require('validator')
const LocalStrategy = require('passport-local').Strategy
const config = require('../../config')
const models = require('../../models')
const logger = require('../../logger')
const { setReturnToFromReferer } = require('../utils')
const { urlencodedParser } = require('../../utils')
const response = require('../../response')

const emailAuth = module.exports = Router()

passport.use(new LocalStrategy({
  usernameField: 'email'
}, async function (email, password, done) {
  if (!validator.isEmail(email)) return done(null, false)

  try {
    const user = await models.User.findOne({
      where: {
        email: email
      }
    })

    if (!user) return done(null, false)
    if (!await user.verifyPassword(password)) return done(null, false)
    return done(null, user)
  } catch (err) {
    logger.error(err)
    return done(err)
  }
}))

if (config.allowEmailRegister) {
  emailAuth.post('/register', urlencodedParser, async function (req, res, next) {
    if (!req.body.email || !req.body.password) return response.errorBadRequest(req, res)
    if (!validator.isEmail(req.body.email)) return response.errorBadRequest(req, res)
    try {
      const [user, created] = await models.User.findOrCreate({
        where: {
          email: req.body.email
        },
        defaults: {
          password: req.body.password
        }
      })

      if (!user) {
        req.flash('error', 'Failed to register your account, please try again.')
        return res.redirect(config.serverURL + '/')
      }

      if (created) {
        logger.debug('user registered: ' + user.id)
        req.flash('info', "You've successfully registered, please signin.")
      } else {
        logger.debug('user found: ' + user.id)
        req.flash('error', 'This email has been used, please try another one.')
      }
      return res.redirect(config.serverURL + '/')
    } catch (err) {
      logger.error('auth callback failed: ' + err)
      return response.errorInternalError(req, res)
    }
  })
}

emailAuth.post('/login', urlencodedParser, function (req, res, next) {
  if (!req.body.email || !req.body.password) return response.errorBadRequest(req, res)
  if (!validator.isEmail(req.body.email)) return response.errorBadRequest(req, res)
  setReturnToFromReferer(req)
  passport.authenticate('local', {
    successReturnToOrRedirect: config.serverURL + '/',
    failureRedirect: config.serverURL + '/',
    failureFlash: 'Invalid email or password.'
  })(req, res, next)
})

emailAuth.post('/image', urlencodedParser, function (req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).send({
      status: 'forbidden'
    })
  }
  const result = models.User.update({
    image: req.body.url
    },{
    where: {
      id: req.user.id
    }
  })
  return res.redirect(config.serverURL + '/')
})

var Scrypt = require('scrypt-kdf')

emailAuth.post('/password', urlencodedParser, async function (req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).send({
      status: 'forbidden'
    })
  }
  const user = await models.User.findOne({
    where: {
      id: req.user.id
    }
  })

  if (!user) {
    return response.errorNotFound(req, res)
  }
  if(!await user.verifyPassword(req.body.password)) {
    return res.status(401).send({
      status: 'Wrong password.'
    })
  }
  const newPwd = (await Scrypt.kdf(req.body.newPassword, await Scrypt.pickParams(0.1))).toString('hex')
  models.User.update({
    password: newPwd
    },{
    where: {
      id: req.user.id
    }
  })
  return res.redirect(config.serverURL + '/')
})

emailAuth.post('/newFolder', urlencodedParser, async function (req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).send({
      status: 'forbidden'
    })
  }
  const user = await models.User.findOne({
    where: {
      id: req.user.id
    }
  })

  if (!user) {
    return response.errorNotFound(req, res)
  }
  
  var parentId = req.headers['referer'].split('?')[1]
  // 判断folder是否存在
  if (parentId) {
    parentId = models.Note.decodeNoteId(parentId)
    const noteCount = await models.Note.count({
      where: {
        ownerId: req.user.id,
        id: parentId
      }
    }).then(function(count){
      if (count === 0) {
        return response.errorNotFound(req, res)
      }
    })
  } else {
    parentId = null
  }
  await models.Note.create({
    title: req.body.folderName,
    content: req.body.folderName,
    ownerId: req.user.id,
    parentId: parentId,
    type: 'FOLDER'
  }).catch(function (err) {
    logger.error('add folder failed: ' + err)
    return response.errorInternalError(req, res)
  })
  if (parentId === null) {
  return res.redirect(config.serverURL + '/')
  }
  return res.redirect(config.serverURL + '/?' + models.Note.encodeNoteId(parentId))
})

emailAuth.post('/removeFolder', urlencodedParser, async function (req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).send({
      status: 'forbidden'
    })
  }
  var userId = req.user.id
  const user = await models.User.findOne({
    where: {
      id: userId
    }
  })

  if (!user) {
    return response.errorNotFound(req, res)
  }
  
  // 校验folderId
  var folderId = models.Note.decodeNoteId(req.body.folderId)
  if (folderId == undefined || folderId == null || folderId === '') {
    return response.errorNotFound(req, res)
  }
  // 判断folder是否存在
  await models.Note.count({
    where: {
      ownerId: userId,
      id: folderId,
      type: 'FOLDER'
    }
  }).then(function(count){
    if (count === 0) {
      return response.errorNotFound(req, res)
    }
  })
  // 判断folder文件夹下是否有文件
  await models.Note.count({
    where: {
      parentId: folderId
    }
  }).then(function(count){
    if (count > 0) {
      return res.status(500).send({
        status: 'remove folder failed: the folder is not empty'
      })
    } else {
      models.Note.destroy({
        where: {
          ownerId: userId,
          id: folderId,
          type: 'FOLDER'
        }
      }).then(function(count) {
        return res.redirect(config.serverURL + '/')
      })
    }
  })
})

emailAuth.post('/replaceFolder', urlencodedParser, async function (req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).send({
      status: 'forbidden'
    })
  }
  var userId = req.user.id
  const user = await models.User.findOne({
    where: {
      id: userId
    }
  })

  if (!user) {
    return response.errorNotFound(req, res)
  }
  
  // 校验folderId
  var folderId = models.Note.decodeNoteId(req.body.folderId)
  var fileId = models.Note.decodeNoteId(req.body.fileId)
  console.log('folderId:', folderId)
  console.log('fileId:', fileId)
  if (folderId == undefined || folderId === '') {
    folderId = null
  }
  if (fileId == undefined || fileId == null || fileId === '') {
    return response.errorNotFound(req, res)
  }
  // 判断folder是否存在
  await models.Note.count({
    where: {
      ownerId: userId,
      id: folderId,
      type: 'FOLDER'
    }
  }).then(function(count){
    if (count === 0) {
      return response.errorNotFound(req, res)
    }
  })
  // 判断file是否存在
  await models.Note.count({
    where: {
      ownerId: userId,
      id: fileId
    }
  }).then(function(count){
    if (count === 0) {
      return response.errorNotFound(req, res)
    }
  })
  // 判断folder文件夹下是否有文件
  await models.Note.update({parentId: folderId}, {
    where: {
      id: fileId
    }
  })
  return res.redirect(config.serverURL + '/')
})