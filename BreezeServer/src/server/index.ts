// BreezeServer Express 서버 진입점

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { requestIdMiddleware, securityHeadersMiddleware, loggingMiddleware, errorHandler, notFoundHandler } from './middleware';
import authRoutes from './routes/auth';
import teacherRoutes from './routes/teachers';
import departmentRoutes from './routes/departments';
import auditRoutes from './routes/audit';
import updateRoutes from './routes/updates';
import settingsRoutes from './routes/settings';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express 앱 생성
const app = express();
const PORT = process.env.SERVER_PORT || 38765;

// 미들웨어 설정
app.use(requestIdMiddleware);
app.use(securityHeadersMiddleware);
app.use(loggingMiddleware);
app.use(helmet({
  contentSecurityPolicy: false, // 개발 편의상 비활성화
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: true, // 모든 오리진 허용 (내부망 환경)
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 정적 파일 서빙 (업데이트 파일 다운로드용)
app.use('/updates', express.static(path.join(__dirname, '..', '..', '..', 'resources', 'updates')));

// 파일 업로드 설정 (업데이트 파일용)
const upload = multer({
  dest: path.join(__dirname, '..', '..', '..', 'temp', 'uploads'),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/x-msdownload' || file.mimetype === 'application/octet-stream' || file.originalname.endsWith('.exe')) {
      cb(null, true);
    } else {
      cb(new Error('실행 파일(.exe)만 업로드 가능합니다.'), false);
    }
  },
});

// 라우트 등록
app.use('/api/auth', authRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/updates', upload.single('file'), updateRoutes);
app.use('/api/settings', settingsRoutes);

// 헬스 체크
app.get('/api/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 및 에러 핸들러
app.use(notFoundHandler);
app.use(errorHandler);

// 서버 시작
export function startServer(): Promise<void> {
  return new Promise((resolve) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[BreezeServer] Express server started on port ${PORT}`);
      resolve();
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    // Express는 자동으로 종료되지 않으므로 별도 처리 필요
    resolve();
  });
}

export { app };