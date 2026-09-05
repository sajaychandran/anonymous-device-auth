require('dotenv').config();

const admin = require('firebase-admin');

admin.initializeApp();

const { signup } = require('./signup');
const { login } = require('./login');
const { recoverPassword } = require('./recovery');

exports.signup = signup;
exports.login = login;
exports.recoverPassword = recoverPassword;
