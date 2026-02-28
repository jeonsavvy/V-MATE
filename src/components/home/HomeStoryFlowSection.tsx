interface StoryFlowStep {
  title: string
  description: string
}

interface HomeStoryFlowSectionProps {
  steps: StoryFlowStep[]
}

export function HomeStoryFlowSection({ steps }: HomeStoryFlowSectionProps) {
  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold tracking-[0.12em] text-[#8c8376]">QUICK GUIDE</p>
        <h2 className="mt-1 text-2xl font-black text-[#252730] sm:text-[2rem]">대화 시작 가이드</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <article
            key={step.title}
            className="rounded-2xl border border-white/45 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(236,229,248,0.82))] p-4 shadow-[0_18px_28px_-24px_rgba(23,21,18,0.72)]"
          >
            <p className="text-[11px] font-black tracking-[0.14em] text-[#7b5cb8]">STEP {index + 1}</p>
            <h3 className="mt-2 text-base font-bold text-[#2f3138]">{step.title}</h3>
            <p className="mt-1 text-sm text-[#5d574d]">{step.description}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
