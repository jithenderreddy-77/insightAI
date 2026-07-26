import { Card } from "@/components/ui/card"

interface ExamplePromptsProps {
  onPromptSelect: (prompt: string) => void
}

const EXAMPLE_PROMPTS = [
  {
    title: "What is this document about?",
    icon: "📄",
  },
  {
    title: "Summarize the key points",
    icon: "✨",
  },
  {
    title: "What are the main conclusions?",
    icon: "🎯",
  },
  {
    title: "Explain this in simple terms",
    icon: "💡",
  },
]

export function ExamplePrompts({ onPromptSelect }: ExamplePromptsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
      {EXAMPLE_PROMPTS.map((prompt, i) => (
        <button
          key={i}
          className="group glass-card rounded-xl p-4 text-left hover:shadow-lg hover:shadow-indigo-500/5 transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-200 cursor-pointer"
          onClick={() => onPromptSelect(prompt.title)}
        >
          <div className="flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5 group-hover:scale-110 transition-transform duration-200">{prompt.icon}</span>
            <p className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">
              {prompt.title}
            </p>
          </div>
        </button>
      ))}
    </div>
  )
}
