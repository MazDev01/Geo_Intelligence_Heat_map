export const adminSeed = env =>
  [{id: 1, name: 'System Administrator', email: (env.ADMIN_EMAIL || 'admin@geointel.io').toLowerCase(), role: 'Administrator'}];
