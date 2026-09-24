import base from './playwright.config.js'
export default { ...base, testDir: 'tests/live', retries: 2, projects: [base.projects[1]] }
