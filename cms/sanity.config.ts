import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemas'
import {deskStructure} from './structure/deskStructure'

const projectId =
  process.env.SANITY_STUDIO_PROJECT_ID ||
  process.env.SANITY_PROJECT_ID ||
  'placeholder'
const dataset =
  process.env.SANITY_STUDIO_DATASET || process.env.SANITY_DATASET || 'production'

export default defineConfig({
  name: 'dac-cms',
  title: 'DAC CMS',
  projectId,
  dataset,
  plugins: [
    structureTool({structure: deskStructure}),
    visionTool(),
  ],
  schema: {
    types: schemaTypes,
  },
})
