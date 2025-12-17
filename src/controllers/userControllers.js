import { logger } from '../utils/logger';

export const getMyInfo = async (req, res) => {
  try {
    if (!req.user) { // // req.user는 authMiddleware에서 JWT 검증 후 주입됨
      return res.status(400).json({
        message: '인증에 실패했습니다. 다시 로그인해주세요.',
      });
    }

    const { user_id, user_name, email, profile_img } = req.user;

    return res.status(200).json({
      userId: user_id,
      name: user_name,
      email,
      profileImg: profile_img,
    });
  } catch (error) {
    logger.error('내 정보 조회 실패: ' + error.message);
    return res.status(500).json({
      message: '내 정보 조회 중 오류가 발생했습니다.',
    });
  }
};
