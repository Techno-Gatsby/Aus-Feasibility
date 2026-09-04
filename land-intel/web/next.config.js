const path = require('path');
/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // Several lockfiles exist above this directory; pin the root so Next does
  // not infer ~/ as the workspace.
  outputFileTracingRoot: path.join(__dirname),
};
