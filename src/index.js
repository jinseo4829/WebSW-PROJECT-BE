import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

//라우트 분리
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import calendarRoutes from './routes/calendarRoutes.js';
import meetRoutes from './routes/meetRoutes.js'; // js 확장자 필수
import { prisma } from './prisma';

const app = express(); // Express 앱 생성

app.use(
    cors({
      origin: true, // 요청 Origin 그대로 허용
      credentials: true,
    })
);

app.use(express.json()); // Content-Type: application/json 요청을 req.body에 파싱
app.use(cookieParser()); // 쿠키 파싱. 모든 요청의 쿠키를 req.cookies 객체로 제공. Refresh Token 재발급 로직에 필수

// auth
app.use('/auth', authRoutes); // 라우터 연결 (URL → 기능 매핑)

// me API
app.use('/me', userRoutes);

// calendar API
app.use('/calendar', calendarRoutes);

// meet API
app.use('/meets', meetRoutes);

// root
app.get('/', (req, res) => {
  res.send('Hello from Express + Prisma + RDS!');
});

// DB Test
app.get('/test-db', async (req, res) => {
  try {
    const now = await prisma.$queryRaw`SELECT NOW()`;
    res.json(now);
  } catch (err) {
    console.error(err);
    res.status(500).send('DB Error');
  }
});

app.listen(4000, () => {
  console.log('Server running at http://localhost:4000');
});
