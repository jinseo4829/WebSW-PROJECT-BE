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
  const buffer = Buffer.alloc(4, 0); // 버퍼는 4바이트씩 4개 총 32bit. 1바이트=8비트.

  for (let i = 0; i < 30; i++) { //하루는 30개 9~24시까지 30분단위로. 버퍼 32비트중 30비트 사용
    if (blocks[i] === 1) {
      const byteIndex = Math.floor(i / 8); // 바이트 순서
      const bitIndex = 7 - (i % 8); //7 6 5 순으로 왼쪽부터
      buffer[byteIndex] |= 1 << bitIndex; //buffer의 byteIndex번째 바이트에서 bitIndex 위치의 비트를 1로 켜라. or연산사용. 이 바이트에서 이 위치의 비트만 켜라
    }
  }

  return buffer;
};

/**
 * 📅 개인 주간 일정 조회
 * GET /calendar/week?day=YYYY-MM-DD
 */
export const getWeeklyCalendar = async (req, res) => {
  try {
    if (!req.user) { // req.user는 authMiddleware에서 JWT 검증 후 주입됨
      return res.status(400).json({ message: '인증 실패' });
    }

    const day = req.query.day; // 기준 날짜(day)
    if (!day) {
      return res.status(400).json({ message: 'day 파라미터가 필요합니다.' });
    }

    const baseDate = new Date(day); //문자열 → Date 객체로 변환
    if (isNaN(baseDate.getTime())) { // 기준 날짜(day) 검증
      return res.status(400).json({ message: 'day 형식이 올바르지 않습니다.' });
    }

    const startDate = new Date(baseDate); // 이번 주의 일요일. 일요일부터시작
    startDate.setDate(baseDate.getDate() - baseDate.getDay()); //getDay()→ 요일을 숫자로 반환 ex) day = 2025-01-22 (수) getDay() = 3 -> 22 - 3 = 19 그 주의 일요일 = 2025-01-19

    const endDate = new Date(startDate); // 끝나는 토툐일
    endDate.setDate(startDate.getDate() + 6); // 일요일 + 6일 = 토요일. 결과: 일~토 총 7일 범위

    const schedules = await prisma.schedule.findMany({ // 로그인한 사용자의 날짜가 이번 주 범위 안 있는 일정만 조회
      where: {
        user_id: req.user.user_id,
        date: { gte: startDate, lte: endDate },
      },
    });

    const scheduleMap = new Map( //schedules 배열의 원소 하나의 타입. 이후 Map에서 타입 안전하게 쓰기 위함
        schedules.map((s) => [
          s.date.toISOString().split('T')[0], // "2025-01-21T00:00:00.000Z" 이걸 T기준으로 파싱해서 키 밸류쌍으로 ["2025-01-19", schedule1],
          s,
        ])
    );

    const days = []; // 최종 응답에 들어갈 주간 일정 배열

    for (let i = 0; i < 7; i++) {
      const current = new Date(startDate);
      current.setDate(startDate.getDate() + i); // startDate = 2025-01-19 (일요일) 여기서 1씩 증가시켜서 i=0 19일, i=1일때 20일 ...
      const dateStr = current.toISOString().split('T')[0]; // 위에 map과 똑같이 T기준 파싱

      const schedule = scheduleMap.get(dateStr); //위에서 만든 map에서 해당 날짜 스케줄 조회

      days.push({
        date: dateStr,
        blocks: schedule
            ? binaryToBlocks(schedule.block_data)
            : new Array(30).fill(0), // 일정이 있으면 최종 배열에 binaryToBlocks 사용해서 넣어주고. 없으면 0으로 채워서 보내기
      });
    }

    return res.status(200).json({
      startDate: startDate.toISOString().split('T')[0],
      days,
    });
  } catch (error) {
    logger.error('주간 일정 조회 실패', error);
    return res.status(500).json({ message: '주간 일정 조회 실패' });
  }
};

/**
 * 💾 개인 주간 일정 저장
 * POST /calendar/week?day=YYYY-MM-DD
 */
export const saveWeeklyCalendar = async (req, res) => {
  try {
    if (!req.user) { // req.user는 authMiddleware에서 JWT 검증 후 주입됨
      return res.status(400).json({ message: '인증 실패' });
    }

    const day = req.query.day; // 기준 날짜
    const days = req.body.days; // 주간 일정

    if (!day || !Array.isArray(days) || days.length !== 7) { //day 존재 여부. days 배열 여부. 길이가 7인지
      return res.status(400).json({ message: '요청 형식이 올바르지 않습니다.' });
    }

    const baseDate = new Date(day); // 기준 날짜(day) //문자열 → Date 객체로 변환
    if (isNaN(baseDate.getTime())) { // 기준 날짜(day) 검증
      return res.status(400).json({ message: 'day 형식이 올바르지 않습니다.' });
    }

    const startDate = new Date(baseDate); // 이번 주의 일요일. 일요일부터시작
    startDate.setDate(baseDate.getDate() - baseDate.getDay()); //getDay()→ 요일을 숫자로 반환 ex) day = 2025-01-22 (수) getDay() = 3 -> 22 - 3 = 19 그 주의 일요일 = 2025-01-19

    const operations = []; // 트랜잭션을 위한 작업 배열 준비. 7일치 upsert 쿼리가 순서대로 쌓입니다. 나중에 await prisma.$transaction(operations); 으로 한 번에 실행됩니다.

    for (let i = 0; i < 7; i++) { // 7일 반복 처리 (일요일 → 토요일)
      const targetDate = new Date(startDate); // 현재 날짜 계산
      targetDate.setDate(startDate.getDate() + i); // i=0 일요일. i=1 월요일 .. i=6 토요일
      const dateStr = targetDate.toISOString().split('T')[0]; // 날짜 문자열 생성. 프론트에서 보낸 date 문자열과 비교용

      const dayData = days.find((d) => d.date === dateStr); // 해당 날짜의 데이터 찾기. 프론트가 보낸 days 배열에서 현재 날짜에 해당하는 데이터 검색
      if (!dayData || !Array.isArray(dayData.blocks) || dayData.blocks.length !== 30) { // blocks 데이터 검증. 배열인지 30칸이지
        return res.status(400).json({ message: 'blocks 형식 오류' });
      }

      operations.push( // Prisma upsert 쿼리 생성 // upsert = update + insert. 있으면 → UPDATE. 없으면 → INSERT
          prisma.schedule.upsert({
            where: {
              date_user_id: { //(user_id + date = 하루에 한 개의 일정만 존재
                date: targetDate,
                user_id: req.user.user_id,
              },
            },
            update: {
              block_data: blocksToBinary(dayData.blocks),
            },
            create: {
              date: targetDate,
              user_id: req.user.user_id,
              block_data: blocksToBinary(dayData.blocks),
            },
          })
      );
    }

    await prisma.$transaction(operations); // 7개 중 하나라도 실패하면 전부 롤백. 주간 일정이 부분 저장되는 일 없음

    return res.status(200).json({
      message: '개인 주간 일정이 저장되었습니다.',
      startDate: startDate.toISOString().split('T')[0],
    });
  } catch (error) {
    logger.error('주간 일정 저장 실패', error);
    return res.status(500).json({ message: '주간 일정 저장 실패' });
  }
};
