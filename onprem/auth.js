'use strict';
/* scrypt 비밀번호 해시 (node:crypto 내장 — 네이티브 의존성 없음) */
const crypto = require('crypto');
const { row, run } = require('./db');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(String(pw || ''), salt, 64).toString('hex');
  return `scrypt$${salt}$${dk}`;
}

function verifyPassword(pw, stored) {
  try {
    const [, salt, dk] = String(stored || '').split('$');
    if (!salt || !dk) return false;
    const cur = crypto.scryptSync(String(pw || ''), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(cur, 'hex'), Buffer.from(dk, 'hex'));
  } catch (e) { return false; }
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, real_name: u.real_name,
    department_id: u.department_id, status: u.status,
    status_message: u.status_message || '', role: u.role,
    is_paid_dual_network: !!u.is_paid_dual_network,
  };
}

function login(username, password) {
  const u = row('SELECT * FROM users WHERE username = ?', String(username || '').trim());
  if (!u || !verifyPassword(password, u.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  try { run('INSERT OR REPLACE INTO sessions (token, user_id) VALUES (?, ?)', token, u.id); } catch (e) { return null; }
  return { token, user: publicUser(u) };
}

function userByToken(token) {
  if (!token) return null;
  const s = row('SELECT * FROM sessions WHERE token = ?', String(token));
  if (!s) return null;
  return publicUser(row('SELECT * FROM users WHERE id = ?', s.user_id));
}

function logout(token) {
  try { run('DELETE FROM sessions WHERE token = ?', String(token || '')); } catch (e) {}
}

module.exports = { hashPassword, verifyPassword, publicUser, login, userByToken, logout };
