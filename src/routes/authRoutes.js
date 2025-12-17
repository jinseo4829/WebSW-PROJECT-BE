import { Router } from 'express';
import {
    kakaoLogin,
    redirectToKakaoLogin,
    logout,
    withdraw,
} from '../controllers/authControllers.js';

const router = Router();

router.get('/kakao', redirectToKakaoLogin); //카카오 로그인 시작점 //카카오 인증 페이지로 리다이렉트
router.post('/kakao-login', kakaoLogin); // 프론트에서 백으로 인가코드 -> 백에서 카카오토큰받아서 jwt토큰만들어서 프론트에 전달

router.post('/logout', logout);
router.delete('/withdraw', withdraw);

export default router;

// 1. 프론트 → /auth/kakao
// 2. 카카오 로그인 페이지
// 3. 카카오 → redirect_uri?code=XXXX
// 4. 프론트 → /auth/kakao-login (code 전달)
// 5. 서버:
// - code → access token
// - access token → user info
// - DB 저장
// - JWT 발급
