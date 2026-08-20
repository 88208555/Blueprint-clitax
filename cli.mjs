#!/usr/bin/env node
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dispatchOfficialSkillCli, runIntakeHandshake } from './installer.mjs'

const INTAKE_QUESTIONS = [
  {
    id: 'goal',
    prompt: 'Describe the product or site goal in one paragraph: what must the user be able to do, and what must never happen.',
    required: true,
    example: 'A bubble-gum minigame that works offline for 60 seconds.',
  },
  {
    id: 'scope',
    prompt: "List the pages, regions, and actors that must be covered, or say 'the whole site'.",
    required: false,
    example: 'One game page plus a results summary.',
  },
  {
    id: 'constraints',
    prompt: 'State hard constraints: platforms, input methods, languages, offline or online, storage, and anything that is forbidden.',
    required: false,
    example: 'No account, no ads, no payments; keyboard and touch only.',
  },
  {
    id: 'acceptance',
    prompt: 'List the acceptance checks that prove the result works, including failure and boundary paths.',
    required: true,
    example: 'Timer, scoring, and results always match the active state; a lower score never overwrites the high score.',
  },
]

await dispatchOfficialSkillCli({
  packageRoot: dirname(fileURLToPath(import.meta.url)),
  runCommand: (context) => runIntakeHandshake(context, {
    questions: INTAKE_QUESTIONS,
    outputFile: 'BLUEPRINT-REQUIREMENTS.json',
    afterCapabilities(output) {
      const instruction = output.nextStep?.instruction
      if (typeof instruction === 'string' && instruction.trim()) console.log(instruction)
    },
  }),
})
