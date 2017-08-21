/* eslint-disable max-lines */
const sessions = require('../../src/services/transactionalSessions');
const { expect } = require('../util/chai');
const { testApp, supertest } = require('../util/supertest');
const { MemoryStore } = require('express-session');
const { OK, INTERNAL_SERVER_ERROR } = require('http-status-codes');

const respondOk = (req, res) => res.sendStatus(OK);
const handleError = (res, next) => {
  return error => {
    if (error && !res._header) {
      res.statusCode = error.status || INTERNAL_SERVER_ERROR;
      res.end(error.message);
    } else {
      next();
    }
  };
};

const createServer = (options, {
  respond = respondOk,
  setup = () => { /* intentionally blank */ }
} = {}) => {
  const cookieOptions = Object.assign({ maxAge: 60 * 1000 }, options.cookie);
  const opts = Object.assign({}, { secret: 'keyboard cat' }, options);
  opts.cookie = cookieOptions;
  const s = sessions(opts);
  const app = testApp();

  app.use((req, res, next) => {
    setup(req, res);
    next();
  });
  app.use((req, res, next) => {
    s(req, res, handleError(res, next));
  });
  app.use(respond);

  return app;
};

const delay = duration => res => new Promise(
  resolve => setTimeout(() => resolve(res), duration)
);

const parseCookie = header => header
  .split(';')
  .map(str => {
    const parts = str.split('=');
    return { key: parts[0].trim(), value: parts[1] || true };
  })
  .reduce((acc, { key, value }) => {
    acc[key] = value;
    return acc;
  }, {});

const cookie = res => {
  const setCookie = res.headers['set-cookie'];
  return (setCookie && setCookie[0]) || undefined;
};

const sid = res => {
  const match = /^[^=]+=s%3A([^;.]+)[.;]/.exec(cookie(res));
  return match ? match[1] : undefined;
};

const shouldHave = number => {
  return {
    sessionsIn(store) {
      return res => {
        const promise = new Promise((resolve, reject) => {
          store.all((error, sess) => {
            if (error) {
              reject(error);
            } else {
              const currentSessions = Object.keys(sess).length;
              resolve(expect(currentSessions).to.eql(number));
            }
          });
        });
        return promise.then(() => res);
      };
    }
  };
};

const shouldNotSetCookie = name => {
  return res => Promise.all([
    expect(Object.keys(res.headers)).to.not.include('set-cookie'),
    expect(res.headers['set-cookie']).to.not.include.match(name)
  ]);
};

const shouldSetCookie = name => {
  return res => Promise.all([
    expect(Object.keys(res.headers)).to.include('set-cookie'),
    expect(res.headers['set-cookie']).to.include.match(name)
  ]).then(() => res);
};

describe('services/transactionalSessions', () => {
  it('presents an express middleware', () => {
    const s = sessions();
    expect(s).to.be.a('function');
  });

  it('accepts express-session session stores', () => {
    const store = new MemoryStore();
    const app = createServer({ store });

    return supertest(app)
      .get('/')
      .expect(200)
      .then(shouldNotSetCookie(/session/));
  });

  it('should error without secret', () => {
    const app = createServer({ secret: undefined });
    return supertest(app)
      .get('/')
      .expect(500, /secret.*required/);
  });

  it('can generate a session', () => {
    const store = new MemoryStore();
    const app = createServer({ store }, {
      respond(req, res) {
        expect(req.session.id).to.be.undefined;
        req.session.generate();
        expect(req.session.id).to.not.be.undefined;
        res.end('session active');
      }
    });
    return supertest(app)
      .get('/')
      .expect(200, 'session active')
      .then(shouldSetCookie(/session/))
      .then(shouldHave(1).sessionsIn(store));
  });

  it('only saves if the session is generated', () => {
    const store = new MemoryStore();
    const app = createServer({ store }, {
      respond(req, res) {
        res.end('session not generated');
      }
    });
    return supertest(app)
      .get('/')
      .expect(200, 'session not generated')
      .then(shouldHave(0).sessionsIn(store));
  });

  it('should load session from cookie session id', () => {
    const app = createServer({}, {
      respond(req, res) {
        if (!req.session.active()) req.session.generate();
        req.session.num = req.session.num || 0;
        req.session.num = req.session.num + 1;
        res.end(`session ${req.session.num}`);
      }
    });

    return supertest(app)
      .get('/')
      .expect(shouldSetCookie(/session/))
      .expect(200, 'session 1')
      .then(res => supertest(app)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(200, 'session 2'));
  });

  it('should pass session fetch error', () => {
    const store = new MemoryStore();
    const app = createServer({ store }, {
      respond(req, res) {
        req.session.generate();
        res.end('hello, world');
      }
    });

    store.get = (id, callback) => {
      callback(new Error('boom!'));
    };

    return supertest(app)
      .get('/')
      .expect(shouldSetCookie(/session/))
      .expect(200, 'hello, world')
      .then(res => supertest(app)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(500, 'boom!')
        .expect(shouldNotSetCookie(/session/)));
  });

  it('should treat ENOENT session fetch error as not found', () => {
    const store = new MemoryStore();
    const app = createServer({ store }, {
      respond(req, res) {
        if (req.session.active()) {
          res.end('session exists');
        } else {
          req.session.generate();
          res.end('session created');
        }
      }
    });

    store.get = (id, callback) => {
      const error = new Error('boom!');
      error.code = 'ENOENT';
      callback(error);
    };

    return supertest(app)
      .get('/')
      .expect(shouldSetCookie(/session/))
      .expect(200, 'session created')
      .then(firstRes => {
        const firstCookie = cookie(firstRes);
        return supertest(app)
          .get('/')
          .set('Cookie', firstCookie)
          .expect(200, 'session created')
          .expect(shouldSetCookie(/session/))
          .expect(res => expect(cookie(res)).to.not.eql(firstCookie));
      });
  });

  it('should create multiple sessions', () => {
    const store = new MemoryStore();
    const app = createServer({ store }, {
      respond(req, res) {
        req.session.generate();
        res.end('created');
      }
    });
    const makeRequest = () => supertest(app).get('/').expect(200, 'created');
    return makeRequest()
      .then(makeRequest)
      .then(shouldHave(2).sessionsIn(store));
  });

  it('should handle multiple res.end calls (no session)', () => {
    const app = createServer({}, {
      respond(req, res) {
        res.setHeader('Content-Type', 'text/plain');
        res.end('Hello, world!');
        res.end();
      }
    });
    return supertest(app)
      .get('/')
      .expect('Content-Type', 'text/plain')
      .expect(200, 'Hello, world!');
  });

  it('should handle multiple res.end calls', () => {
    const app = createServer({}, {
      respond(req, res) {
        req.session.generate();
        res.setHeader('Content-Type', 'text/plain');
        res.end('Hello, world!');
        res.end();
      }
    });
    return supertest(app)
      .get('/')
      .expect('Content-Type', 'text/plain')
      .expect(shouldSetCookie(/session/))
      .expect(200, 'Hello, world!');
  });

  it('should handle res.end(null) calls (no session)', () => {
    const app = createServer({}, {
      respond(req, res) {
        res.end(null);
      }
    });
    return supertest(app)
      .get('/')
      .expect(200);
  });

  it('should handle res.end(null) calls', () => {
    const app = createServer({}, {
      respond(req, res) {
        req.session.generate();
        res.end(null);
      }
    });
    return supertest(app)
      .get('/')
      .expect(shouldSetCookie(/session/))
      .expect(200);
  });

  it('should update cookie expiration when slow write', () => {
    const app = createServer({ rolling: true }, {
      respond(req, res) {
        req.session.generate();
        req.session.user = 'bob';
        res.write('hello, ');
        setTimeout(() => res.end('world!'), 100);
      }
    });
    const expires = res => parseCookie(cookie(res)).Expires;

    return supertest(app)
      .get('/')
      .expect(shouldSetCookie(/session/))
      .expect(200)
      .then(delay(1000))
      .then(first => {
        return supertest(app)
          .get('/')
          .set('Cookie', cookie(first))
          .expect(200)
          .expect(shouldSetCookie(/session/))
          .then(second => expect(expires(first)).to.not.eql(expires(second)));
      });
  });

  it('should save even with multi-write', () => {
    const store = new MemoryStore();
    const app = createServer({ store }, {
      respond(req, res) {
        req.session.generate();
        req.session.hit = true;
        res.write('hello, ');
        res.write('world');
        res.end();
      }
    });
    return supertest(app)
      .get('/')
      .expect(200)
      .expect(shouldHave(1).sessionsIn(store));
  });

  it('should have saved session even with non-chunked response', () => {
    const store = new MemoryStore();
    const app = createServer({ store }, {
      respond(req, res) {
        req.session.generate();
        req.session.hit = true;
        res.setHeader('Content-Length', '13');
        res.end();
      }
    });
    return supertest(app)
      .get('/')
      .expect(200)
      .expect(shouldHave(1).sessionsIn(store));
  });

  describe('when a sid is not signed', () => {
    const store = new MemoryStore();
    const app = createServer({ store }, {
      respond(req, res) {
        if (req.session.active()) {
          res.end('session loaded');
        } else {
          req.session.generate();
          res.end('session created');
        }
      }
    });
    const makeRequest = () => supertest(app).get('/');
    const makeRequestWithUnsignedSid = res => {
      const unsignedSid = sid(res);
      return makeRequest().set('Cookie', `session=${unsignedSid}`);
    };

    it('should not load from the store', () => {
      return makeRequest()
        .expect(200, 'session created')
        .then(makeRequestWithUnsignedSid)
        .then(shouldSetCookie(/session/));
    });

    it('should create a new session', () => {
      const currentSessions = Object.keys(store.sessions).length;
      return makeRequest()
        .then(makeRequestWithUnsignedSid)
        .then(shouldHave(currentSessions + 2).sessionsIn(store));
    });

    it('should generate a new sid', () => {
      return makeRequest()
        .then(first => makeRequestWithUnsignedSid(first)
          .then(second => {
            return { first, second };
          }))
        .then(({ first, second }) => {
          return expect(sid(first)).to.not.eql(sid(second));
        });
    });
  });

  describe('when session expired in store', () => {
    const store = new MemoryStore();
    const app = createServer({ store, cookie: { maxAge: 5 } }, {
      respond(req, res) {
        if (req.session.active()) {
          res.end('session loaded');
        } else {
          req.session.generate();
          res.end('session created');
        }
      }
    });
    const makeRequest = () => supertest(app)
      .get('/')
      .expect(200, 'session created');

    it('new requests should create a new session', () => {
      return makeRequest()
        .then(delay(20))
        .then(makeRequest)
        .then(shouldHave(1).sessionsIn(store));
    });

    it('should generate a new sid', () => {
      return makeRequest()
        .then(first => makeRequest().then(second => {
          return expect(sid(first)).to.not.eql(sid(second));
        }));
    });

    it('should not exist in the store', () => {
      return makeRequest()
        .then(delay(10))
        .then(shouldHave(0).sessionsIn(store));
    });
  });

  describe('trustProxy option', () => {
    describe('when enabled', () => {
      const app = () => createServer({
        proxy: true,
        cookie: { secure: true }
      }, {
        respond(req, res) {
          req.session.generate();
          res.end();
        }
      });
      it('should trust X-Forwarded-Proto when string', () => {
        return supertest(app())
          .get('/')
          .set('X-Forwarded-Proto', 'https')
          .expect(shouldSetCookie(/session/))
          .expect(200);
      });

      it('should trust X-Forwarded-Proto when comma-separated list', () => {
        return supertest(app())
          .get('/')
          .set('X-Forwarded-Proto', 'https,http')
          .expect(shouldSetCookie(/session/))
          .expect(200);
      });

      it('should not work when no header', () => {
        return supertest(app())
          .get('/')
          .expect(shouldNotSetCookie(/session/))
          .expect(500);
      });
    });

    describe('when disabled', () => {
      const app = () => createServer({
        proxy: false,
        cookie: { secure: true }
      }, {
        respond(req, res) {
          req.session.generate();
          res.end();
        }
      });
      it('should not trust X-Forwarded-Proto', () => {
        return supertest(app())
          .get('/')
          .set('X-Forwarded-Proto', 'https')
          .expect(shouldNotSetCookie(/session/))
          .expect(500);
      });
    });
  });

  describe('cookie option', () => {
    describe('when "path" set to "/foo/bar"', () => {
      const app = () => createServer({ cookie: { path: '/foo/bar' } }, {
        respond(req, res) {
          if (req.session) {
            req.session.generate();
            res.end('session active');
          } else {
            res.end('no session');
          }
        }
      });

      it('should not set cookie for "/" request', () => {
        return supertest(app())
          .get('/')
          .expect(shouldNotSetCookie(/session/))
          .expect(200, 'no session');
      });

      it('should not set cookie for "http://foo/bar" request', () => {
        return supertest(app())
          .get('/')
          .set('host', 'http://foo/bar')
          .expect(shouldNotSetCookie(/session/))
          .expect(200, 'no session');
      });

      it('should set cookie for "/foo/bar" request', () => {
        return supertest(app())
          .get('/foo/bar/baz')
          .expect(shouldSetCookie(/session/))
          .expect(200);
      });

      it('should set cookie for "/foo/bar/baz" request', () => {
        return supertest(app())
          .get('/foo/bar/baz')
          .expect(shouldSetCookie(/session/))
          .expect(200);
      });
    });
  });
});

describe('#isSecure', () => {
  describe('trust proxy enabled', () => {
    it('returns true when proxy forwards https requests', () => {
      const req = {
        connection: { encrypted: false },
        secure: false,
        headers: { 'x-forwarded-proto': 'https' }
      };
      return expect(sessions.isSecure(req, true)).to.be.true;
    });

    it('returns true when connection is encrypted', () => {
      const req = {
        connection: { encrypted: true },
        secure: false,
        headers: { 'x-forwarded-proto': 'http' }
      };
      return expect(sessions.isSecure(req, true)).to.be.true;
    });

    it('returns false when proxy forwards http requests', () => {
      const req = {
        connection: { encrypted: false },
        secure: false,
        headers: { 'x-forwarded-proto': 'http' }
      };
      return expect(sessions.isSecure(req, true)).to.be.false;
    });

    it('returns false when no proxy', () => {
      const req = {
        connection: { encrypted: false },
        secure: false,
        headers: {}
      };
      return expect(sessions.isSecure(req, true)).to.be.false;
    });

    it('returns false even if req.secure is set', () => {
      const req = {
        connection: { encrypted: false },
        secure: true,
        headers: {}
      };
      return expect(sessions.isSecure(req, true)).to.be.false;
    });
  });

  describe('trust proxy disabled', () => {
    it('returns false when proxy forwards https requests', () => {
      const req = {
        connection: { encrypted: false },
        secure: false,
        headers: { 'x-forwarded-proto': 'https' }
      };
      return expect(sessions.isSecure(req, false)).to.be.false;
    });

    it('returns false when proxy forwards http requests', () => {
      const req = {
        connection: { encrypted: false },
        secure: false,
        headers: { 'x-forwarded-proto': 'http' }
      };
      return expect(sessions.isSecure(req, false)).to.be.false;
    });

    it('returns true when no proxy and encrypted connection', () => {
      const req = {
        connection: { encrypted: true },
        secure: false,
        headers: {}
      };
      return expect(sessions.isSecure(req, false)).to.be.true;
    });

    it('returns true if req.secure is set', () => {
      const req = {
        connection: { encrypted: false },
        secure: true,
        headers: {}
      };
      return expect(sessions.isSecure(req, false)).to.be.true;
    });

    it('returns true if req.secure is proxied', () => {
      const req = {
        connection: { encrypted: false },
        secure: true,
        headers: { 'x-forwarded-proto': 'http' }
      };
      return expect(sessions.isSecure(req, false)).to.be.true;
    });

    it('returns true if encrypted connection is proxied', () => {
      const req = {
        connection: { encrypted: true },
        secure: false,
        headers: { 'x-forwarded-proto': 'http' }
      };
      return expect(sessions.isSecure(req, false)).to.be.true;
    });
  });
});
