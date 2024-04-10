
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fromFileUrl } from "https://deno.land/std/path/mod.ts"
import {
    preferenceValidatorAgentSystemMessage,
    preferenceValidatorAgentFunctions
} from '../../supabase/functions/shared/llm/preferencevalidatoragent_types.ts'

type TrainingExample = {
    input: string,
    output: string
}

const successExamples = [
    {
        input: 'I like apples',
        output: 'I like **apples**'
    },
    {
        input: 'no meat',
        output: 'no **meat**'
    },
    {
        input: 'i don\'t like the taste of vanilla in anything.',
        output: 'i don\'t like the taste of **vanilla** in anything.'
    },
    {
        input: 'I cannot eat onion or garlic',
        output: 'I cannot eat **onion** or **garlic**'
    },
    {
        input: 'I am lactose intolerant',
        output: 'I am **lactose intolerant**'
    },
    {
        input: 'i am vegan but collagen is ok',
        output: 'i am **vegan** but **collagen** is ok'
    },
    {
        input: 'I am allergic to peanuts, but other nuts are ok',
        output: 'I am allergic to **peanuts**, but other nuts are ok'
    },
    {
        input: 'I prefer olive, avocado, or coconut oil over seed oils',
        output: 'I prefer **olive, avocado, or coconut oil** over **seed oils**'
    },
    {
        input: 'Flag Aspartame, and high fructose corn syrup',
        output: 'Flag **Aspartame**, and **high fructose corn syrup**'
    },
    {
        input: 'no added sugar',
        output: 'no **added sugar**'
    },
    {
        input: 'Vegatarian. These are ok though: dairy, eggs, fish',
        output: '**Vegatarian**. These are ok though: **dairy, eggs, fish**'
    },
    {
        input: 'No artificial preservatives',
        output: 'No **artificial preservatives**'
    }
]

const successTrainingData = successExamples.map((example: TrainingExample) => {
    return [
        {
            role: 'user',
            content: example.input
        },
        {
            role: 'assistant',
            function_call: {
                name: 'report_success',
                arguments: JSON.stringify({
                    annotatedPreference: example.output
                })
            }
        }
    ]
})

const failureExamples = [
    {
        input: 'I like food',
        output: 'This is too broad. Please be more specific.'
    },
    {
        input: 'I am allergic to everything',
        output: 'This is too broad. Please be more specific.'
    },
    {
        input: 'I am allergic to everything except water',
        output: 'This is too broad. Please be more specific.'
    },
    {
        input: 'I am allergic to everything except water and air',
        output: 'This is too broad. Please be more specific.'
    },
    {
        input: 'sfdf kd',
        output: 'This does not make sense. Please provide a dietary preference.'
    },
    {
        input: 'what is your name?',
        output: 'I cannot answer questions. Please provide a dietary preference.'
    },
    {
        input: 'how many calories in an egg?',
        output: 'I cannot answer questions. Please provide a dietary preference.'
    },
    {
        input: 'no hugs',
        output: 'This does not make sense. Please provide a dietary preference.'
    },
    {
        input: 'i prefer diet coke',
        output: 'I cannot identify items yet. Please provide a dietary preference that can be mapped to ingredients.'
    },
    {
        input: 'low sodium',
        output: 'Sodium is a nutrient and not an ingredient.'
    },
    {
        input: 'I want low sugar.',
        output: 'I cannot flag ingredients based on quantity yet.'
    },
    {
        input: 'easy on sugar',
        output: 'I cannot flag ingredients based on quantity yet.'
    },
    {
        input: 'I love spicy food',
        output: 'Please provide a dietary preference that can be mapped to ingredients.'
    }
]

const failureTrainingData = failureExamples.map((example: TrainingExample) => {
    return [
        {
            role: 'user',
            content: example.input
        },
        {
            role: 'assistant',
            function_call: {
                name: 'report_failure',
                arguments: JSON.stringify({
                    explanation: example.output
                })
            }
        }
    ]
})

const trainingData = successTrainingData.concat(failureTrainingData)

const finetuningData = trainingData.map((messages: any) => {
    messages.unshift({
        role: 'system',
        content: preferenceValidatorAgentSystemMessage
    })
    return {
        messages: messages,
        functions: preferenceValidatorAgentFunctions
    }
})

const moduleDir = fromFileUrl(new URL('.', import.meta.url))
const fullDatasetPath = path.join(moduleDir, './datasets/preferencevalidatordatasetgenerator.jsonl')
fs.writeFileSync(fullDatasetPath, finetuningData.map(data => JSON.stringify(data)).join('\n'))

console.log(`Wrote ${finetuningData.length} examples to ${fullDatasetPath}`)