import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-pet', [
  'src/index.ts',
  'src/invariant.ts',
], {
  libExternal: ['@deepseek-ai/dsh-settings'],
})
