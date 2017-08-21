const { Cookie } = require('./Cookie');
const { Session: ExpressSession } = require('express-session');
const { crc32 } = require('crc');

class Session extends ExpressSession {
  constructor(req, sessionData, cookieOptions) {
    super(req, sessionData);
    this.cookie = new Cookie(cookieOptions);
    this.defineNotEnumerable('originalHash', this.hash());
    this.defineNotEnumerable('generatedOrLoaded', false);
  }

  defineNotEnumerable(property, value) {
    Object.defineProperty(this, property, {
      enumerable: false,
      value,
      writable: true
    });
  }

  hash() {
    const sessionData = JSON.stringify(this, (key, val) => {
      /* eslint-disable no-undefined */
      if (key === 'cookie') return undefined;
      /* eslint-enable */
      return val;
    });
    return crc32(sessionData);
  }

  active() {
    // console.log(this.id);
    return typeof this.id === 'string' && this.generatedOrLoaded;
  }

  shouldSave() {
    return this.active();
  }

  shouldSetCookie() {
    return this.active();
  }

  /*
   * Create a new session and delete any existing session
   */
  generate() {
    if (this.active()) this.destroy();
    this.req.sessionStore.generate(this.req);
    this.req.session.generatedOrLoaded = true;
    return this.req.session;
  }

  /*
   * Inflate the session from data loaded from a store
   */
  inflate(fromSession) {
    const sessionData = fromSession;
    const { expires, originalMaxAge } = fromSession.cookie;
    sessionData.cookie = new Cookie(fromSession.cookie);
    if (typeof expires === 'string') {
      sessionData.cookie.expires = new Date(expires);
    }
    sessionData.cookie.originalMaxAge = originalMaxAge;
    this.req.session = new Session(this.req, sessionData);
    this.req.session.generatedOrLoaded = true;
    return this.req.session;
  }
}

module.exports = Session;
