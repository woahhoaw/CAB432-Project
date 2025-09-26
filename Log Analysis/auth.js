const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const axios = require('axios');

let pems = null;

async function initCognito({ region = 'ap-southeast-2', userPoolId }) {
  const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const { data } = await axios.get(url);
  pems = {};
  data.keys.forEach(k => { pems[k.kid] = jwkToPem(k); });
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) return res.status(401).json({ message: 'Missing token' });

  const decoded = jwt.decode(token, { complete: true });
  const pem = decoded && pems && pems[decoded.header.kid];
  if (!pem) return res.status(401).json({ message: 'Invalid token' });

  jwt.verify(token, pem, { algorithms: ['RS256'] }, (err, claims) => {
    if (err) return res.status(401).json({ message: 'Invalid token' });
    // Cognito user name and groups
    req.user = {
      sub: claims['cognito:username'] || claims['username'] || claims['sub'],
      email: claims.email,
      groups: claims['cognito:groups'] || []
    };
    
    req.user.role = req.user.groups.includes('admin') ? 'admin' : 'analyst';
    next();
  });
}

function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) return next(new Error('Unauthenticated'));
    if (role === 'admin' && !req.user.groups.includes('admin')) {
      return _res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

module.exports = { initCognito, authMiddleware, requireRole };
