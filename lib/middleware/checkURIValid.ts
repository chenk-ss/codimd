import * as logger from '../logger'
import * as response from "../response";

export = function (req, res, next) {
  try {
    decodeURIComponent(req.path)
  } catch (err) {
    logger.error(err)
    return response.errorBadRequest(req, res)
  }
  next()
}