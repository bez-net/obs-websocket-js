const test = require('ava');
const env = require('./setup/environment');
const { OBSWebSocket } = require('..');
const SHA256 = require('sha.js/sha256');
const WebSocket = require('ws');

let unauthServer;
let authServer;

const password = 'supersecretpassword';

test.before(() => {
  unauthServer = env.makeServer(4444);
  authServer = env.makeServer(4443);

  const salt = 'PZVbYpvAnZut2SS6JNJytDm9';
  const challenge = 'ztTBnnuqrqaKDzRM3xcVdbYm';
  const secret = new SHA256().update(password).update(salt).digest('base64');
  const expectedAuthResponse = new SHA256().update(secret).update(challenge).digest('base64');

  authServer.storedResponses.GetAuthRequired = () => {
    return {
      authRequired: true,
      salt,
      challenge
    };
  };

  authServer.storedResponses.Authenticate = data => {
    return data.auth === expectedAuthResponse ? {} : {status: 'error', error: 'authentication failed'};
  };
});

test.after.always('cleanup', () => {
  authServer.close();
  unauthServer.close();
});

test('connects when auth is not required', async t => {
  const obs = new OBSWebSocket();
  await t.notThrowsAsync(obs.connect({
    address: 'localhost:4444'
  }));
});

test('connects when auth is required', async t => {
  const obs = new OBSWebSocket();
  await t.notThrowsAsync(obs.connect({
    address: 'localhost:4443',
    password
  }));
});

test('fails to connect when an incorrect url is provided', async t => {
  const obs = new OBSWebSocket();
  try {
    await obs.connect({
      address: 'localhost:4442'
    });
    t.fail('expected promise rejection');
  } catch (e) {
    t.is(e.status, 'error');
    t.is(e.code, 'CONNECTION_ERROR');
    t.is(e.error, 'Connection error.');
  }
});

test.cb('rejects a promise when a connection fails', t => {
  const obs = new OBSWebSocket();
  obs.connect({
    address: 'localhost:4442'
  }).then(() => {
    t.fail('Expected a promise rejection when a connection cannot be established.');
  }).catch(err => {
    t.is(err.status, 'error');
    t.is(err.code, 'CONNECTION_ERROR');
    t.is(err.error, 'Connection error.');
    t.end();
  });
});

test('fails to connect when the wrong password is provided', async t => {
  const obs = new OBSWebSocket();
  try {
    await obs.connect({
      address: 'localhost:4443',
      password: 'wrong_password'
    });
    t.fail('expected promise rejection');
  } catch (e) {
    t.is(e.error, 'authentication failed');
  }
});

test.cb('emits ConnectionOpened', t => {
  const obs2 = new OBSWebSocket();
  obs2.on('ConnectionOpened', () => {
    t.end();
  });

  obs2.connect({
    address: 'localhost:4444'
  });
});

test.cb('emits ConnectionClosed', t => {
  const obs2 = new OBSWebSocket();
  obs2.on('ConnectionClosed', () => {
    t.end();
  });

  obs2.connect({
    address: 'localhost:4444'
  }).then(() => {
    obs2.disconnect();
  });
});

test.cb('emits AuthenticationSuccess', t => {
  const obs2 = new OBSWebSocket();
  obs2.on('AuthenticationSuccess', () => {
    t.end();
  });

  obs2.connect({
    address: 'localhost:4443',
    password: 'supersecretpassword'
  });
});

test.cb('emits AuthenticationFailure', t => {
  const obs2 = new OBSWebSocket();
  obs2.on('AuthenticationFailure', () => {
    t.end();
  });

  obs2.connect({
    address: 'localhost:4443',
    password: 'wrong_password'
  }).catch(() => {});
});

test.cb('throws AuthenticationFailure', t => {
  const obs2 = new OBSWebSocket();
  obs2.connect({
    address: 'localhost:4443',
    password: 'wrong_password'
  }).catch(() => {
    t.end();
  });
});

test.cb('emits error when an unhandled socket error occurs', t => {
  const obs2 = new OBSWebSocket();
  obs2.on('ConnectionOpened', () => {
    obs2.socket.onerror('first error message');
    obs2.socket.onerror('second error message');
    t.end();
  });

  let errorCount = 0;

  obs2.on('error', error => {
    errorCount += 1;
    switch (errorCount) {
      case 1:
        t.is(error, 'first error message');
        break;
      case 2:
        t.is(error, 'second error message');
        t.end();
        break;
      default:
        t.fail();
    }
  });

  obs2.connect({
    address: 'localhost:4444'
  });
});

// eslint-disable-next-line quotes
test.cb(`emits 'message' when an unrecognized socket message is received`, t => {
  const obs2 = new OBSWebSocket();
  obs2.on('ConnectionOpened', () => {
    obs2.send('echo', {
      emitMessage: {
        message: 'message'
      }
    });
  });

  obs2.on('message', msg => {
    t.is(msg.message, 'message');
    t.end();
  });

  obs2.connect({
    address: 'localhost:4444'
  });
});

test('closes an existing connection when `connect` is called again', async t => {
  const obs = new OBSWebSocket();

  let open = false;

  // Verify that the previous connection was closed.
  obs.on('ConnectionOpened', () => {
    t.false(open);
    open = true;
  });

  obs.on('ConnectionClosed', () => {
    open = false;
  });

  await t.notThrowsAsync(obs.connect({
    address: 'localhost:4444'
  }));

  t.true(open);

  await t.notThrowsAsync(obs.connect({
    address: 'localhost:4444'
  }));

  t.true(open);
});

test('closes in-flight sockets when `connect` is called', async t => {
  const obs = new OBSWebSocket();
  obs.connected = false;

  // A minimal stub of a socket that is currently connecting.
  let closeCalled = 0;
  obs.socket = {
    readyState: WebSocket.CONNECTING,
    close() {
      closeCalled++;
    }
  };

  await t.notThrowsAsync(obs.connect({
    address: 'localhost:4444'
  }));

  t.is(closeCalled, 1);
});
