const { expect } = require('../../util/chai');
const Session = require('../../../src/services/sessions/Session');

const testEnumerable = (propertyName, enumerable) => {
  return () => {
    const session = new Session({}, {}, {});
    return expect(session).to.have.ownPropertyDescriptor(propertyName)
      .that.has.property('enumerable').that.eql(enumerable);
  };
};
const testNotProperty = name => {
  return () => {
    const session = new Session({}, {}, {});
    return expect(session).to.not.have.own.property(name);
  };
};

const fakeSessionStore = {
  generate(req) {
    req.sessionID = '1';
    req.session = new Session(req, {}, {});
  }
};

describe('services/sessions/Session', () => {
  describe('#generate', () => {
    it('will not be saved', testNotProperty('generate'));
  });

  describe('#shouldSave', () => {
    it('will not be saved', testNotProperty('shouldSave'));
  });

  describe('#shouldSetCookie', () => {
    it('will not be saved', testNotProperty('shouldSetCookie'));

    it('returns true if session exists', () => {
      const fakeReq = { sessionStore: Object.assign({}, fakeSessionStore) };
      const s = (new Session(fakeReq, {}, {})).generate();
      return expect(s.shouldSetCookie()).to.be.true;
    });
  });

  describe('#active', () => {
    it('will not be saved', testNotProperty('active'));

    it('returns false if session was created by constructor', () => {
      const s = new Session({}, {}, {});
      return expect(s.active()).to.be.false;
    });

    it('returns true if session was created by generate', () => {
      const fakeReq = { sessionStore: Object.assign({}, fakeSessionStore) };
      const s = (new Session(fakeReq, {}, {})).generate();
      return expect(s.active()).to.be.true;
    });

    it('returns true if session was created by inflate', () => {
      const fakeReq = {
        sessionID: '1',
        sessionStore: Object.assign({}, fakeSessionStore)
      };
      const loadedData = { foo: 'foo', cookie: {} };
      const s = (new Session(fakeReq, {}, {})).inflate(loadedData);
      return expect(s.active()).to.be.true;
    });
  });

  describe('#inflate', () => {
    it('will not be saved', testNotProperty('inflate'));
  });

  describe('#cookie', () => {
    it('will be saved in the session store', testEnumerable('cookie', true));
  });

  describe('#hash', () => {
    it('will not be saved', testNotProperty('hash'));

    it('returns a consistent hash', () => {
      const session = new Session({}, { foo: 'foo' }, {});
      return expect(session.hash()).to.eql(session.hash());
    });

    it('returns identical hashes for the same session data', () => {
      const s1 = new Session({}, { foo: 'foo' }, {});
      const s2 = new Session({}, { foo: 'foo' }, {});
      return expect(s1.hash()).to.eql(s2.hash());
    });

    it('returns a hash based only on session data', () => {
      const sessionData = { foo: 'foo' };
      const s1 = new Session({ foo: 'foo' }, sessionData, { maxAge: 100 });
      const s2 = new Session({ bar: 'bar' }, sessionData, {});
      return expect(s1.hash()).to.eql(s2.hash());
    });
  });

  describe('#originalHash', () => {
    it('will not be saved', testEnumerable('originalHash', false));

    it('is populated with the session hash on creation', () => {
      const session = new Session({}, {}, {});
      return expect(session.originalHash).to.eql(session.hash());
    });
  });
});
