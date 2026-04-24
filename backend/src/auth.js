const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const db = require('./db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'Stepanov.maxim@gmail.com';

if (process.env.GOOGLE_CLIENT_ID) {
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  const callbackURL = publicUrl.replace(/\/$/, '') + '/api/auth/google/callback';
  console.log('Google OAuth callback URL:', callbackURL);

  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const { id, displayName, emails, photos } = profile;
        const email = emails[0].value;
        const avatar = photos?.[0]?.value || '';
        const role = email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'pending';

        let user = await db.queryOne('SELECT * FROM users WHERE google_id = $1', [id]);

        if (!user) {
          const existingByEmail = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);
          if (existingByEmail) {
            await db.query('UPDATE users SET google_id = $1, name = $2, avatar_url = $3 WHERE id = $4',
              [id, displayName, avatar, existingByEmail.id]);
            user = await db.queryOne('SELECT * FROM users WHERE id = $1', [existingByEmail.id]);
          } else {
            const result = await db.query(
              "INSERT INTO users (google_id, email, name, avatar_url, role) VALUES ($1, $2, $3, $4, $5) RETURNING id",
              [id, email, displayName, avatar, role]
            );
            user = await db.queryOne('SELECT * FROM users WHERE id = $1', [result.rows[0].id]);
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));
} else {
  console.warn('GOOGLE_CLIENT_ID not set. Google OAuth is disabled.');
  console.warn('Use the dev token endpoint: POST /api/auth/dev-login');
  console.warn('  body: { "email": "Stepanov.maxim@gmail.com" }');
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { passport, generateToken, verifyToken, ADMIN_EMAIL };
