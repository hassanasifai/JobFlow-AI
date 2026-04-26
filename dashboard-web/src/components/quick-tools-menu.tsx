'use client';

import { useState } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Sparkles, GraduationCap, Lightbulb, Send } from 'lucide-react';
import { QuickEvalDialog } from '@/components/quick-eval-dialog';

/**
 * Top-bar dropdown that opens any of the smaller agent-driven tools that
 * don't deserve their own page: Training evaluator, Project evaluator,
 * Outreach drafter. Each uses the same QuickEvalDialog skeleton with a
 * different endpoint and prompt template.
 */
export function QuickToolsMenu() {
  const [open, setOpen] = useState<'training' | 'project' | 'contacto' | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Tools
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Quick agent tools</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen('training')}>
            <GraduationCap className="h-3.5 w-3.5 mr-2" />
            Evaluate course / cert
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen('project')}>
            <Lightbulb className="h-3.5 w-3.5 mr-2" />
            Evaluate portfolio idea
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen('contacto')}>
            <Send className="h-3.5 w-3.5 mr-2" />
            Draft LinkedIn outreach
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <QuickEvalDialog
        open={open === 'training'}
        onOpenChange={(o) => setOpen(o ? 'training' : null)}
        endpoint="/api/eval-training"
        title="Evaluate a course / certification"
        description="modes/training.md scores 6 dimensions: north-star alignment, recruiter signal, cost vs ROI, time, depth, market trend."
        inputLabel="Paste the course / cert details"
        inputPlaceholder={"e.g.\n\nAWS Solutions Architect Associate\n6 weeks · ~$300\nCovers compute, storage, networking, security, well-architected framework.\nIndustry-recognized."}
        buildBody={(input, modelId) => ({ text: input, model_id: modelId })}
        minInputChars={30}
      />

      <QuickEvalDialog
        open={open === 'project'}
        onOpenChange={(o) => setOpen(o ? 'project' : null)}
        endpoint="/api/eval-project"
        title="Evaluate a portfolio project idea"
        description="modes/project.md scores signal-for-target-roles, uniqueness, build cost, completion rate, recruiter signal, and proof-point yield."
        inputLabel="Describe the project"
        inputPlaceholder={"e.g.\n\nA web app that uses GPT to evaluate job offers and generate tailored CVs.\nStack: Next.js, Tailwind, Anthropic SDK.\nEstimated 2 weeks build time."}
        buildBody={(input, modelId) => ({ text: input, model_id: modelId })}
        minInputChars={40}
      />

      <QuickEvalDialog
        open={open === 'contacto'}
        onOpenChange={(o) => setOpen(o ? 'contacto' : null)}
        endpoint="/api/contacto"
        title="Draft LinkedIn outreach"
        description="modes/contacto.md outputs 3 message variants targeting hiring managers and recruiters at the company."
        inputLabel="Company + role + any context"
        inputPlaceholder={"e.g.\n\nCompany: Anthropic\nRole: Forward Deployed Engineer\nLooking to reach a hiring manager. I have 5 yrs in LLM agents."}
        buildBody={(input, modelId) => {
          // Heuristic split — the user types free-form; we extract company/role
          // if they used the suggested format, else hand the agent the raw text.
          const m = input.match(/Company:\s*([^\n]+)[\s\S]*Role:\s*([^\n]+)/i);
          return {
            company: m?.[1]?.trim() || 'unknown',
            role: m?.[2]?.trim() || 'unknown',
            context: input,
            model_id: modelId,
          };
        }}
        minInputChars={20}
      />
    </>
  );
}
