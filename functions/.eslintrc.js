module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
    es2024: true,
  },
  extends: [
    "eslint:recommended",
    "google",
  ],
  rules: {
    "quotes": ["error", "double"],
    "require-jsdoc": 0,
    "max-len": "off", // Disable the max-len rule for the whole project
  },
};
