import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';

//컨트롤러나 미들웨어가 직접 JWT 로직을 다루지 않게 하기 위한 분리입니다.

// 1. 환경 변수 로딩
const JWT_SECRET = process.env.JWT_SECRET; // Access Token 서명
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET; // Refresh Token 서명

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  logger.error('FATAL: JWT_SECRET 또는 JWT_REFRESH_SECRET 환경 변수가 설정되지 않았습니다.');
  throw new Error(
      'JWT Secret Key 환경 변수가 설정되지 않았습니다. .env 파일을 확인해주세요.'
  );
}

// 2. 만료 시간 (문자열 기준)
const ACCESS_EXP = process.env.JWT_ACCESS_EXPIRATION || '1h';
const REFRESH_EXP = process.env.JWT_REFRESH_EXPIRATION || '14d';

const createJwtPayload = (user) => { // Payload에 들어가는 것: 인증/식별에 필요한 최소 정보
  return {
    userId: user.user_id,
    email: user.email,
    kakaoID: user.kakao_id.toString(),
  };
};

// JWT 액세스 토큰 생성
export const generateAccessToken = (user) => {
  const payload = createJwtPayload(user);

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_EXP,
  });
};

// JWT 리프래시 토큰 생성
export const generateRefreshToken = (user) => {
  const payload = createJwtPayload(user);

  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_EXP,
  });
};

// JWT 액세스 토큰 갱신
export const refreshAccessToken = async (req) => {
  try {
    const refreshToken = req.cookies?.refreshToken; // 쿠키에서 Refresh Token 추출
    if (!refreshToken) {
      throw new Error('Refresh Token이 필요합니다.');
    }

    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET); // Refresh Token 검증 // 토큰 서명 검증. 만료 시간(exp) 체크. payload 디코딩

    const user = await prisma.weBandUser.findUnique({ // 사용자 DB 재검증
      where: { user_id: decoded.userId },
    });

    if (!user) {
      throw new Error('사용자를 찾을 수 없습니다.');
    }

    const newAccessToken = generateAccessToken(user); // 새 Access Token 발급

    logger.info(`Refresh Token 검증 성공 - 새로운 Access Token 발급: ${user.email}`);

    return newAccessToken;
  } catch (err) {
    logger.error('Refresh Token 검증 실패: ' + err.message);
    throw new Error('유효하지 않거나 만료된 Refresh Token입니다.');
  }
};
