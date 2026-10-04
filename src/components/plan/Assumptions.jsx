import React from 'react';

// project import
import { useAppData } from '../../state/AppDataContext';

// ==============================|| ASSUMPTIONS ||============================== //

// 아직 확인하지 않은 가정값을 화면에 정직하게 보여 준다.
const Assumptions = () => {
  const { settings, plan } = useAppData();
  return (
    <div className="small text-muted mt-2">
      <div>
        [가정] 한 세트(성인 약 5인분)로 아이 {settings.childMealsPerSet}끼 · 냉장분은 {settings.fridgeDays}일 안에 먹이기 · 요리 요일
        월·수·금 (설정에서 변경 예정)
      </div>
      <div>식단은 어린이급식관리지원센터 작년 같은 달 표준식단의 하루 구성을 그대로 따릅니다. 밥은 소분 냉동 밥을 쓰세요.</div>
      {plan.warnings.map((w, i) => (
        <div key={i} className="text-warning">
          {w}
        </div>
      ))}
    </div>
  );
};

export default Assumptions;
