const { Cookie } = require('./Cookie');
const { Session } = require('express-session');

class TransactionalSession extends Session {
  generate() {
    if (this.exists()) this.destroy();
    this.req.sessionStore.generate(this.req);
  }

  shouldSave() {
    return this.exists();
  }

  shouldSetCookie() {
    return this.exists();
  }

  exists() {
    return typeof this.id !== 'undefined';
  }

  inflate(fromSession) {
    const sessionData = fromSession;
    const { expires, originalMaxAge } = fromSession.cookie;
    sessionData.cookie = new Cookie(fromSession.cookie);
    if (typeof expires === 'string') {
      sessionData.cookie.expires = new Date(expires);
    }
    sessionData.cookie.originalMaxAge = originalMaxAge;
    this.req.session = new TransactionalSession(this.req, sessionData);
    return this.req.session;
  }
}

module.exports = TransactionalSession;
