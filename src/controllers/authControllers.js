import { prisma } from '../prisma';
import axios from 'axios';
import { logger } from '../utils/logger';
import { generateAccessToken, generateRefreshToken } from '../services/jwtServices';
import qs from 'qs';

// 카카오 로그인 페이지로 리디렉션
export const redirectToKakaoLogin = (req, res) => {
  const redirectUri = process.env.REDIRECT_URI; // 카카오 개발자 콘솔에 미리 등록된 콜백 URL
  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${process.env.REST_API_KEY}&redirect_uri=${redirectUri}`;
  //카카오 인증 URL 생성 // 로그인 성공 시 → 인가 코드(code) 를 redirect URI로 전달
  res.redirect(kakaoAuthUrl); // 카카오 인증 페이지로 리다이렉트 // 서버가 카카오 로그인 페이지로 브라우저를 직접 이동
};

// 카카오 로그인 (인가코드 → DB → JWT)
export const kakaoLogin = async (req, res) => {
  try {
    const { code } = req.body; // code는 카카오가 발급한 1회성 인가 코드

    if (!code) {
      return res.status(400).json({ message: '인가 코드가 필요합니다.' });
    }

    const redirectUri = process.env.REDIRECT_URI;

    // 1️⃣ 카카오 Access Token 요청
    const tokenRes = await axios.post(
        'https://kauth.kakao.com/oauth/token',
        qs.stringify({ // 전송 데이터
          grant_type: 'authorization_code',
          client_id: process.env.REST_API_KEY,
          redirect_uri: redirectUri,
          code,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
          },
        }
    );

    const kakaoAccessToken = tokenRes.data.access_token; // 이 카카오토큰으로 카카오 API 호출 가능

    // 2️⃣ 카카오 유저 정보 조회
    const userRes = await axios.get('https://kapi.kakao.com/v2/user/me', {
      headers: {
        Authorization: `Bearer ${kakaoAccessToken}`,
      },
    });

    const { id: kakaoId, kakao_account, properties } = userRes.data; // 카카오에서 받은 유저 정보

    const email = kakao_account?.email; // 이메일 검증
    if (!email) {
      return res.status(400).json({
        message: '카카오 이메일 제공 동의가 필요합니다.',
      });
    }

    const userName = properties?.nickname ?? email.split('@')[0]; // 사용자 이름결정. 닉네임 있으면 사용. 없으면 이메일 앞부분 대체
    const profile_img = properties?.profile_image ?? null; // 프로필 이미지 결정

    // 3️⃣ DB upsert
    const user = await prisma.weBandUser.upsert({ // 첫 로그인 create. 재로그인 update
      where: { email }, // 유니크 키
      update: {
        kakao_id: BigInt(kakaoId),
        user_name: userName,
        profile_img,
      },
      create: {
        kakao_id: BigInt(kakaoId),
        email,
        user_name: userName,
        profile_img,
      },
    });

    logger.info(`카카오 로그인 성공: ${email}`);

    // 4️⃣ JWT 발급
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // 5️⃣ Refresh Token 쿠키 저장
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true, // HTTPS 환경
      sameSite: 'none',
    });

    // 6️⃣ 응답
    return res.status(200).json({
      accessToken,
      refreshToken,
    });
  } catch (error) {
    logger.error(
        '카카오 로그인 실패',
        JSON.stringify(error.response?.data || error.message, null, 2)
    );
    return res.status(500).json({ message: '카카오 로그인 실패' });
  }
};

// 로그아웃
export const logout = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: '로그인 상태가 아닙니다.' });
    }

    res.cookie('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'dev',
      sameSite: 'none',
      expires: new Date(0), // 쿠키 즉시 만료. JWT 방식의 표준 로그아웃
    });

    logger.info(`로그아웃 완료: ${req.user.email}`);
    return res.status(200).json({ message: '로그아웃 성공' });
  } catch (error) {
    logger.error('로그아웃 실패:', error.message);
    return res.status(500).json({ message: '로그아웃 실패' });
  }
};

// 회원 탈퇴
export const withdraw = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: '로그인 상태가 아닙니다.' });
    }

    const userId = req.user.user_id;

    await prisma.weBandUser.delete({ //db에서 회원삭제
      where: { user_id: userId },
    });

    logger.info(`회원 탈퇴 완료: ${userId}`);
    return res.status(200).json({ message: '회원 탈퇴 성공' });
  } catch (error) {
    logger.error('회원 탈퇴 실패:', error.message);
    return res.status(500).json({ message: '회원 탈퇴 실패' });
  }
};
