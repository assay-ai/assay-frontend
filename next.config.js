/** @type {import('next').NextConfig} */
 const fs = require("fs");

const getLatestCommit = () => {
  try {
    const rev = fs.readFileSync(".git/HEAD").toString().trim();
    let buildId;

    if (rev.indexOf(":") === -1) {
      buildId = rev;
    } else {
      buildId = fs
        .readFileSync(`.git/${rev.substring(5)}`)
        .toString()
        .trim();
    }

    return buildId.substring(0, 8);
  } catch (error) {
    console.warn("Could not get git commit hash, falling back to timestamp");
    return Date.now().toString();
  }
};

module.exports = {
  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    buildId: getLatestCommit(),
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    return config;
  },
};
