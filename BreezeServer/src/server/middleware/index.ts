// BreezeServer Express 미들웨어

import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { getDatabase } from '../database';

// 요청 ID 생성
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.headers['x-request-id'] = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.headers['x-request-id']);
  next();
}

// 보안 헤더
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

// 요청 로깅
export function loggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = req.headers['x-request-id'];

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${requestId}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}

// 에러 핸들링
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id'];
  console.error(`[${requestId}] Error:`, err);

  // 개발 환경에서는 스택 트레이스 포함
  const isDevelopment = process.env.NODE_ENV !== 'production';

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: isDevelopment ? err.message : '서버 내부 오류가 발생했습니다.',
    requestId,
    ...(isDevelopment && { stack: err.stack }),
  });
}

// 404 핸들러
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `경로를 찾을 수 없습니다: ${req.method} ${req.path}`,
  });
}

// IP 주소 추출
export function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] as string ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

// User-Agent 추출
export function getUserAgent(req: Request): string {
  return req.headers['user-agent'] || 'unknown';
}

// 감사 로그 기록 헬퍼
export async function auditLog(
  adminId: string,
  adminName: string,
  action: string,
  targetType: string,
  targetId: string,
  targetName: string,
  detail: string,
  req: Request,
  riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low',
  metadata?: Record<string, unknown>
): Promise<void> {
  const db = getDatabase();

  const previousLog = db.prepare(`
    SELECT hash FROM audit_logs ORDER BY created_at DESC LIMIT 1
  `).get() as { hash: string } | undefined;

  const previousHash = previousLog?.hash || '0'.repeat(64);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const data = `${id}${adminId}${action}${targetType}${targetId}${detail}${getClientIp(req)}${createdAt}${previousHash}`;
  const hash = crypto.createHash('sha256').update(data).digest('hex');

  db.prepare(`
    INSERT INTO audit_logs (
      id, admin_id, admin_name, action, target_type, target_id, target_name,
      detail, ip_address, user_agent, risk_level, metadata, hash, previous_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    adminId,
    adminName,
    action,
    targetType,
    targetId,
    targetName,
    detail,
    getClientIp(req),
    getUserAgent(req),
    riskLevel,
    metadata ? JSON.stringify(metadata) : null,
    hash,
    previousHash,
    createdAt
  );
}