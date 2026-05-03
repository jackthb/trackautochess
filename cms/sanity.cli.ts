import 'dotenv/config'
import {defineCliConfig} from 'sanity/cli'

const projectId = process.env.SANITY_PROJECT_ID || process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_DATASET || process.env.SANITY_STUDIO_DATASET || 'production'

if (!projectId) {
  // Fall back so `sanity init` can still run; commands that need it will error clearly.
  console.warn('[sanity.cli] SANITY_PROJECT_ID not set. Run `sanity init` or set it in .env.')
}

export default defineCliConfig({
  api: {
    projectId: projectId || 'placeholder',
    dataset,
  },
  studioHost: 'trackautochess',
})
