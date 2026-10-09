// 브리즈 부트 스플래시 (B 마크 호흡 + BREEZE 뒤집기 + 점 3개)
// 외부 자산 없이 CSS 키프레임만으로 그린다.
export default function BootSplash({ text = "로컬 DB를 여는 중이에요…" }: { text?: string }) {
  return (
    <div className="h-full grid place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-2.5 px-6 text-center">
        <div className="edu-boot-visual" aria-hidden="true">
          <div className="edu-boot-mark">B</div>
        </div>
        <div className="edu-boot-word" aria-hidden="true">
          <span>B</span><span>R</span><span>E</span><span>E</span><span>Z</span><span>E</span>
        </div>
        <div>
          <div className="font-extrabold text-[17px] tracking-tight">브리즈</div>
          <div className="text-[12.5px] text-edu-sub mt-0.5">{text}</div>
        </div>
        <div className="edu-boot-dots" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </div>
  );
}
