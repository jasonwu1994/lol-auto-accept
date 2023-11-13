module.exports = {
  packagerConfig: {
    asar: false,
    ignore: [
      "node_modules/.cache",
      ".*/.idea",
      ".*/.gitignore",
      "public",
      "resources/.*/.*",
      "resources/(?!.*.ico$).*$",
      ".*forge\\.config\\.js",
      ".*\\.env",
      "^/src",
      "^/app-config.json",
      "^/yarn-error.log"
    ],
    compression: "maximum",
    icon: "resources/icon.ico"
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip'
    }
  ],
};
