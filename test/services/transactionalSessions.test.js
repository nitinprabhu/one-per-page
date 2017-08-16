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
  const opts = Object.assign({}, { secret: 'keyboard cat' }, options);
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

const cookie = res => {
  const setCookie = res.headers['set-cookie'];
  return (setCookie && setCookie[0]) || undefined;
};

const shouldNotHaveHeader = header => {
  return res => {
    const checks = [expect(Object.keys(res.headers)).to.not.contain(header)];
    return Promise.all(checks).then(() => res);
  };
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
      .then(shouldNotHaveHeader('Set-Cookie'));
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
        req.session.active = true;
        res.end('session active');
      }
    });
    return supertest(app)
      .get('/')
      .expect(200, 'session active')
      .then(shouldSetCookie(/session/))
      .then(() => expect(Object.keys(store.sessions)).to.have.lengthOf(1));
  });

  it('only saves if the session is generated', () => {
    const store = new MemoryStore();
    const app = createServer({ store }, {
      respond(req, res) {
        req.session.active = true;
        res.end('session not generated');
      }
    });
    return supertest(app)
      .get('/')
      .expect(200, 'session not generated')
      .then(() => expect(Object.keys(store.sessions)).to.have.lengthOf(0));
  });

  it('should load session from cookie sid', () => {
    const app = createServer({}, {
      respond(req, res) {
        if (!req.session.exists()) req.session.generate();
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
});
