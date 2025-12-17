import { prisma } from '../prisma';
import { logger } from '../utils/logger';

/**
 * BINARY(4) → blocks[30]
 */
const binaryToBlocks = (buffer) => {
  const blocks = [];

  for (let byteIndex = 0; byteIndex < 4; byteIndex++) {
    for (let bit = 7; bit >= 0; bit--) {
      blocks.push((buffer[byteIndex] >> bit) & 1);
    }
  }

  return blocks.slice(0, 30);
};

/**
 * blocks[30] → BINARY(4)
 */
const blocksToBinary = (blocks) => {
  const buffer = Buffer.alloc(4, 0);

  for (let i = 0; i < 30; i++) {
    if (blocks[i] === 1) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = 7 - (i % 8);
      buffer[byteIndex] |= 1 << bitIndex;
    }
  }

  return buffer;
};

/**
 * POST /meets
 * 모임 생성: group 생성 + owner를 member에 자동 가입
 * request body:
 * {
 *   "meetName": "산학 회의",
 *   "meetDate": "2025-03-22" // 모임 시작 날짜(7일 중 첫 날)
 * }
 */
export const createMeet = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: '인증에 실패했습니다. 다시 로그인해주세요.' });
    }

    const { meetName, meetDate } = req.body || {};

    if (!meetName || !meetName.trim()) {
      return res.status(400).json({ message: '모임 이름이 올바르지 않습니다.' });
    }

    if (!meetDate) {
      return res.status(400).json({ message: 'meetDate 값이 필요합니다.' });
    }

    const date = new Date(meetDate);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ message: 'meetDate 형식이 올바르지 않습니다.' });
    }

    const created = await prisma.$transaction(async (tx) => {
      // 1. 랜덤 groupId 생성 (중복 방지)
      let groupId;
      while (true) {
        groupId = Math.floor(100000 + Math.random() * 900000);
        const exists = await tx.group.findUnique({
          where: { group_id: groupId },
        });
        if (!exists) break;
      }

      // 2. group 생성
      const group = await tx.group.create({
        data: {
          group_id: groupId,
          group_name: meetName.trim(),
          group_date: date,
          owner_id: req.user.user_id,
        },
      });

      // 3. 생성자 자동 가입
      await tx.member.create({
        data: {
          group_id: group.group_id,
          user_id: req.user.user_id,
        },
      });

      return group;
    });

    return res.status(200).json({
      message: '모임이 성공적으로 생성되었습니다.',
      meetId: created.group_id,
    });
  } catch (error) {
    logger.error('모임 생성 실패: ' + error.message);
    return res.status(500).json({ message: '모임 생성 중 오류가 발생했습니다.' });
  }
};

/**
 * GET /meets
 * 모임 목록
 */
export const getMyMeets = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({
        message: '인증에 실패했습니다. 다시 로그인해주세요.',
      });
    }

    const memberships = await prisma.member.findMany({
      where: { user_id: req.user.user_id },
      select: { group_id: true },
    });

    const groupIds = memberships.map((m) => m.group_id);
    if (groupIds.length === 0) {
      return res.status(200).json({ meets: [] }); // 가입된 모임 없음
    }

    const groups = await prisma.group.findMany({
      where: { group_id: { in: groupIds } },
      orderBy: { group_id: 'desc' },
    });

    // owner 이름 조회
    const ownerIds = Array.from(new Set(groups.map((g) => g.owner_id)));
    const owners = await prisma.weBandUser.findMany({
      where: { user_id: { in: ownerIds } },
      select: { user_id: true, user_name: true },
    });
    const ownerNameMap = new Map(owners.map((o) => [o.user_id, o.user_name]));

    // 멤버 수까지
    const counts = await prisma.member.groupBy({
      by: ['group_id'],
      where: { group_id: { in: groupIds } },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.group_id, c._count._all]));
    // countMap.get(group_id) = > 멤버 수 출력
    return res.status(200).json({
      meets: groups.map((g) => ({
        meetId: g.group_id,
        meetName: g.group_name,
        memberCount: countMap.get(g.group_id) ?? 0,
        owner: ownerNameMap.get(g.owner_id) ?? '알 수 없음',
      })),
    });
  } catch (error) {
    logger.error('내 모임 목록 조회 실패: ' + error.message);
    return res.status(500).json({ message: '내 모임 목록 조회 중 오류가 발생했습니다.' });
  }
};

/**
 * POST /meets/join/:meetId
 * 모임 가입
 * member insert, 중복 방지
 */
export const joinMeet = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: '인증에 실패했습니다. 다시 로그인해주세요.' });
    }

    const meetId = Number(req.params.meetId); // url
    if (!Number.isFinite(meetId)) {
      return res.status(400).json({ message: 'meetId 형식이 올바르지 않습니다.' });
    }

    const group = await prisma.group.findUnique({
      where: { group_id: meetId },
    });

    if (!group) {
      // 명세: 유효하지 않은 초대 코드
      return res.status(400).json({ message: '유효하지 않은 초대 코드입니다.' });
    }

    // 중복 가입 방지: member PK(group_id, user_id)
    try {
      await prisma.member.create({
        data: {
          group_id: meetId,
          user_id: req.user.user_id,
        },
      });
    } catch (e) {
      // Prisma unique/PK 충돌은 보통 P2002
      if (e?.code === 'P2002') {
        return res.status(200).json({ message: '이미 가입된 모임입니다.' });
      }
      throw e;
    }

    return res.status(200).json({
      message: '모임에 성공적으로 가입했습니다.',
      meetId,
    });
  } catch (error) {
    logger.error('모임 가입 실패: ' + error.message);
    return res.status(500).json({ message: '모임 가입 중 오류가 발생했습니다.' });
  }
};

/**
 * GET /meets/:meetId
 * meet + members (+ schedules) 조합해서 내려주는 핵심
 * 모임 정보조회
 */
export const getMeetDetail = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: '인증에 실패했습니다. 다시 로그인해주세요.' });
    }

    const meetId = Number(req.params.meetId);
    if (!Number.isFinite(meetId)) {
      return res.status(400).json({ message: 'meetId 형식이 올바르지 않습니다.' });
    }

    // 1) 모임 조회
    const meet = await prisma.group.findUnique({ where: { group_id: meetId } });
    if (!meet) {
      return res.status(404).json({ message: '존재하지 않는 모임입니다.' });
    }

    // 2) 가입 여부(참/거짓만)
    const membership = await prisma.member.findUnique({
      where: {
        group_id_user_id: {
          group_id: meetId,
          user_id: req.user.user_id,
        },
      },
    });
    const participate = !!membership;

    // 3) 멤버 목록(모든 사용자에게 공개)
    const memberRows = await prisma.member.findMany({
      where: { group_id: meetId },
      select: { user_id: true },
    });
    const memberUserIds = memberRows.map((m) => m.user_id);

    // 멤버가 없으면
    if (memberUserIds.length === 0) {
      return res.status(200).json({
        meetId: meet.group_id,
        meetName: meet.group_name,
        startDate: meet.group_date.toISOString().split('T')[0],
        participate,
        member: [],
      });
    }

    // 4) startDate부터 7일 날짜 배열 생성
    const startDateObj = new Date(meet.group_date);
    // 날짜만 쓰기 위해 시간 00:00 정규화(타임존 이슈 완화)
    startDateObj.setHours(0, 0, 0, 0);

    const dates = [];
    const dateStrs = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(startDateObj);
      d.setDate(startDateObj.getDate() + i);
      dates.push(d);
      dateStrs.push(d.toISOString().split('T')[0]);
    }

    const endDateObj = new Date(dates[6]);
    endDateObj.setHours(23, 59, 59, 999);

    // 5) 7일 범위 스케줄 조회(멤버 전원)
    const schedules = await prisma.schedule.findMany({
      where: {
        user_id: { in: memberUserIds },
        date: { gte: startDateObj, lte: endDateObj },
      },
      select: { user_id: true, date: true, block_data: true },
    });

    // userId -> dateStr -> blocks(0/1 30개)
    const scheduleMap = new Map();
    for (const s of schedules) {
      const dateStr = s.date.toISOString().split('T')[0];
      const blocks = binaryToBlocks(s.block_data);

      let userMap = scheduleMap.get(s.user_id);
      if (!userMap) {
        userMap = new Map();
        scheduleMap.set(s.user_id, userMap);
      }
      userMap.set(dateStr, blocks);
    }

    // 6) 유저 이름 조회 (memberName에 필요)
    const users = await prisma.weBandUser.findMany({
      where: { user_id: { in: memberUserIds } },
      select: { user_id: true, user_name: true },
    });

    // userId -> name
    const nameMap = new Map();
    for (const u of users) {
      nameMap.set(u.user_id, u.user_name);
    }

    // 7) 응답 스펙에 맞게 member 배열 구성
    const member = memberUserIds.map((userId) => {
      return {
        memberName: nameMap.get(userId) ?? `USER_${userId}`,
        days: dateStrs.map((dateStr) => ({
          date: dateStr,
          blocks: scheduleMap.get(userId)?.get(dateStr) ?? new Array(30).fill(0),
        })),
      };
    });

    // 8) 최종 응답
    return res.status(200).json({
      meetId: meet.group_id,
      meetName: meet.group_name,
      startDate: startDateObj.toISOString().split('T')[0],
      participate,
      member,
    });
  } catch (error) {
    logger.error('모임 상세 조회 실패: ' + error.message);
    return res.status(500).json({ message: '모임 상세 조회 중 오류가 발생했습니다.' });
  }
};

/**
 * PATCH /meets/:meetId
 * owner 체크
 *
 * body 예시:
 * { "meetName": "새이름" }
 */
export const updateMeet = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: '인증에 실패했습니다. 다시 로그인해주세요.' });
    }

    const meetId = Number(req.params.meetId);
    if (!Number.isFinite(meetId)) {
      return res.status(400).json({ message: 'meetId 형식이 올바르지 않습니다.' });
    }

    const group = await prisma.group.findUnique({ where: { group_id: meetId } });
    if (!group) {
      return res.status(404).json({ message: '존재하지 않는 모임입니다.' });
    }

    if (group.owner_id !== req.user.user_id) {
      return res.status(403).json({ message: '모임 이름을 수정할 권한이 없습니다.' });
    }

    const { meetName } = req.body || {};

    if (!meetName || !meetName.trim()) {
      return res.status(400).json({ message: '모임 이름이 올바르지 않습니다.' });
    }

    const updated = await prisma.group.update({
      where: { group_id: meetId },
      data: {
        group_name: meetName.trim(),
      },
    });

    return res.status(200).json({
      message: '모임 이름이 성공적으로 수정되었습니다.',
      meetId: updated.group_id,
      meetName: updated.group_name,
    });
  } catch (error) {
    logger.error('모임 수정 실패: ' + error.message);
    return res.status(500).json({ message: '모임 수정 중 오류가 발생했습니다.' });
  }
};

/**
 * DELETE /meets/:meetId
 * owner 체크 + member 정리
 */
export const deleteMeet = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: '인증에 실패했습니다. 다시 로그인해주세요.' });
    }

    const meetId = Number(req.params.meetId);
    if (!Number.isFinite(meetId)) {
      return res.status(400).json({ message: 'meetId 형식이 올바르지 않습니다.' });
    }

    const group = await prisma.group.findUnique({ where: { group_id: meetId } });
    if (!group) {
      return res.status(404).json({ message: '존재하지 않는 모임입니다.' });
    }

    if (group.owner_id !== req.user.user_id) {
      return res.status(403).json({ message: '모임을 삭제할 권한이 없습니다.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.member.deleteMany({ where: { group_id: meetId } });
      await tx.group.delete({ where: { group_id: meetId } });
    });

    return res.status(200).json({ message: '모임이 성공적으로 삭제되었습니다.' });
  } catch (error) {
    logger.error('모임 삭제 실패: ' + error.message);
    return res.status(500).json({ message: '모임 삭제 중 오류가 발생했습니다.' });
  }
};

/**
 * DELETE /meets/:meetId/exit/:userId
 * 본인 탈퇴 vs 강퇴 권한 처리
 *
 * - 본인 탈퇴: actor(user) == target(userId)
 * - 강퇴: actor는 owner여야 함
 * - owner는 탈퇴/강퇴 대상이 될 수 없음(정책)
 */
export const exitMeetOrKick = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: '인증에 실패했습니다. 다시 로그인해주세요.' });
    }

    const meetId = Number(req.params.meetId);
    const targetUserId = Number(req.params.userId);

    if (!Number.isFinite(meetId) || !Number.isFinite(targetUserId)) {
      return res.status(400).json({ message: '파라미터 형식이 올바르지 않습니다.' });
    }

    const group = await prisma.group.findUnique({ where: { group_id: meetId } });
    if (!group) {
      return res.status(404).json({ message: '존재하지 않는 모임입니다.' });
    }

    const actorUserId = req.user.user_id;
    const isOwner = group.owner_id === actorUserId;
    const isSelf = actorUserId === targetUserId;

    // 명세: 타 멤버 탈퇴(=강퇴)는 OWNER만 가능
    if (!isSelf && !isOwner) {
      return res.status(403).json({ message: '멤버를 강퇴할 권한이 없습니다.' });
    }

    if (targetUserId === group.owner_id) {
      return res.status(400).json({ message: '모임장은 탈퇴/강퇴 처리할 수 없습니다.' });
    }

    const targetMembership = await prisma.member.findUnique({
      where: {
        group_id_user_id: {
          group_id: meetId,
          user_id: targetUserId,
        },
      },
    });

    if (!targetMembership) {
      return res.status(404).json({ message: '강퇴 대상 멤버가 존재하지 않습니다.' });
    }

    await prisma.member.delete({
      where: {
        group_id_user_id: {
          group_id: meetId,
          user_id: targetUserId,
        },
      },
    });

    return res.status(200).json({
      message: isSelf ? '모임에서 성공적으로 탈퇴했습니다.' : '해당 멤버를 성공적으로 강퇴했습니다.',
      removedUserId: targetUserId,
    });
  } catch (error) {
    logger.error('모임 탈퇴/강퇴 실패: ' + error.message);
    return res.status(500).json({ message: '모임 탈퇴/강퇴 처리 중 오류가 발생했습니다.' });
  }
};
