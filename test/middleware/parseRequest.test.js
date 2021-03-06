const { expect, sinon } = require('../util/chai');
const { testStep } = require('../util/supertest');
const Page = require('../../src/steps/Page');
const parseRequest = require('../../src/middleware/parseRequest');
const { field, form } = require('../../src/services/fields.js');

const handlerTest = (_form, { method = 'get', assertions }) => {
  const _step = new class extends Page {
    get middleware() {
      return [parseRequest];
    }
    get url() {
      return '/test';
    }
    get form() {
      return _form;
    }
    handler(req, res) {
      assertions(req, res);
      res.end();
    }
  }();
  return testStep(_step).execute(method).expect(200);
};

describe('middleware/parseRequest', () => {
  it('attaches an Object to req.fields', () => {
    return handlerTest(form(), {
      assertions(req) {
        expect(req).to.have.property('fields');
        expect(req.fields).to.be.an('object');
      }
    });
  });

  it('attaches a FieldDesriptor for each field to req.fields.[name]', () => {
    return handlerTest(form(field('foo'), field('bar')), {
      assertions(req) {
        expect(req.fields).to.have.property('foo');
        expect(req.fields).to.have.property('bar');
      }
    });
  });

  it('attaches #valid to req.fields', () => {
    return handlerTest(form(), {
      assertions(req) {
        expect(req.fields.validate).to.be.a('function');
      }
    });
  });

  it('attaches req.fields to the currentStep (this in handler)', () => {
    return handlerTest(form(field('foo'), field('bar')), {
      assertions(req) {
        expect(req.currentStep.fields).to.eql(req.fields);
      }
    });
  });

  describe('req.fields', () => {
    it('is empty if step.fields is not defined', () => {
      const step = new class extends Page {
        get middleware() {
          return [parseRequest];
        }
        get url() {
          return '/test';
        }
        handler(req, res) {
          expect(req.fields).to.be.an('object');
          expect(req.fields).to.be.empty;
          res.end();
        }
      }();

      return testStep(step).get().expect(200);
    });


    it('has a field for each declared field', () => {
      return handlerTest(form(field('foo'), field('bar')), {
        assertions(req) {
          expect(req.fields).to.have.keys(['foo', 'bar']);
        }
      });
    });

    describe('GET', () => {
      it('calls #deserialize for each field', () => {
        const fakeField = field('fake');
        sinon.spy(fakeField, 'deserialize');
        return handlerTest(form(fakeField), {
          assertions(req) {
            expect(req.fields).to.have.key('fake');
            expect(req.fields.fake).to.have.property('name', 'fake');
          }
        }).then(() => expect(fakeField.deserialize).calledOnce);
      });
    });

    describe('POST', () => {
      it('calls #parse for each field', () => {
        const fakeField = field('fake');
        sinon.spy(fakeField, 'parse');
        return handlerTest(form(fakeField), {
          method: 'post',
          assertions(req) {
            expect(req.fields).to.have.key('fake');
            expect(req.fields.fake).to.have.property('name', 'fake');
          }
        }).then(() => expect(fakeField.parse).calledOnce);
      });
    });
  });
});
