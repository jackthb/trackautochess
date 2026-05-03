import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {presentationTool} from 'sanity/presentation'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemas'
import {deskStructure} from './structure/deskStructure'
import {locations} from './structure/locations'

const projectId =
  process.env.SANITY_STUDIO_PROJECT_ID ||
  process.env.SANITY_PROJECT_ID ||
  'placeholder'
const dataset =
  process.env.SANITY_STUDIO_DATASET || process.env.SANITY_DATASET || 'production'

// Web frontend that the Presentation tool iframes. Local dev defaults to
// localhost:3000; production deploys should set SANITY_STUDIO_PREVIEW_ORIGIN
// to https://www.trackautochess.com so the deployed Studio loads the live site.
const previewOrigin = process.env.SANITY_STUDIO_PREVIEW_ORIGIN || 'http://localhost:3000'

export default defineConfig({
  name: 'dac-cms',
  title: 'DAC CMS',
  projectId,
  dataset,
  plugins: [
    presentationTool({
      resolve: locations,
      previewUrl: {
        origin: previewOrigin,
        preview: '/',
        previewMode: {
          enable: '/api/draft/enable',
          disable: '/api/draft/disable',
        },
      },
      allowOrigins: [
        'https://www.trackautochess.com',
        'https://trackautochess.com',
        'http://localhost:3000',
      ],
    }),
    structureTool({structure: deskStructure}),
    visionTool(),
  ],
  schema: {
    types: schemaTypes,
  },
})
