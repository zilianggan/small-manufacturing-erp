module.exports = {
  packagerConfig: {
    asar: true,
    icon: "./assets/icon",
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'SengJieEngineeringERP',
        setupIcon: "./assets/icon.ico",
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
};
