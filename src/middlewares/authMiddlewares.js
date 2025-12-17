import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { refreshAccessToken } from '../services/jwtServices';
import { logger } from '../utils/logger';
//모든 보호된 API 요청에 대해
// Access Token을 검증하고,
// 만료된 경우 Refresh Token으로 자동 재발급까지 처리한 뒤,
// req.user에 로그인 사용자를 주입하는 인증 게이트
// 사용자 인증 미들웨어 (JWT 토큰)
export const authMiddleware = async (req, res, next) => { // 요청에서 Access Token 추출
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.split(' ')[1] : null;

  if (!token) {
    logger.error('Access Token이 필요합니다.');
    return res.status(401).json({ message: 'Access Token이 필요합니다.' });
  }

  try { // Access Token 검증
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // 토큰 서명 검증. 만료 시간(exp) 체크. payload 디코딩

    const user = await prisma.weBandUser.findUnique({ // DB에서 실제 사용자 조회
      where: { user_id: decoded.userId },
    });

    if (!user) {
      logger.error('사용자를 찾을 수 없습니다.');
      return res.status(401).json({ message: '사용자를 찾을 수 없습니다.' });
    }

    req.user = { // req.user에 주입
      user_id: user.user_id,
      kakao_id: user.kakao_id.toString(),
      email: user.email,
      user_name: user.user_name,
      profile_img: user.profile_img,
    };

    return next(); // 요청이 다음 미들웨어 / 컨트롤러로 이동. 이 시점에서 “인증 완료”
  } catch (err) {
    if (err.name === 'TokenExpiredError') { // 만료에러
      try {
        const newAccessToken = await refreshAccessToken(req); // 새 Access Token 생성

        req.headers.authorization = `Bearer ${newAccessToken}`;

        const decoded = jwt.verify(newAccessToken, process.env.JWT_SECRET); // 새 토큰으로 다시 사용자 검증

        const user = await prisma.weBandUser.findUnique({ // // 사용자 재조회
          where: { user_id: decoded.userId },
        });

        if (!user) {
          return res.status(401).json({ message: '사용자를 찾을 수 없습니다.' });
        }

        req.user = { // req.user 재주입
          user_id: user.user_id,
          kakao_id: user.kakao_id.toString(),
          email: user.email,
          user_name: user.user_name,
          profile_img: user.profile_img,
        };

        res.setHeader('x-access-token', newAccessToken);
        logger.info(`새 Access Token 발급: ${user.email}`);

        return next(); // // 요청이 다음 미들웨어 / 컨트롤러로 이동. 이 시점에서 “인증 완료”
      } catch (refreshErr) { // Refresh Token까지 실패한 경우
        logger.error('새로운 Access Token 발급 실패: ' + refreshErr.message);
        return res.status(401).json({ message: '새로운 Access Token 발급 실패' });
      }
    }

    logger.error('유효하지 않은 Access Token입니다.');
    return res.status(401).json({ message: '유효하지 않은 Access Token입니다.' });
  }
};
