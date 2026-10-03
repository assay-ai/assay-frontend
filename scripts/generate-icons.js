const fs = require("fs");
const path = require("path");

const ICONS_DIR = path.join(__dirname, "../src/components/icons");
const INDEX_FILE = path.join(ICONS_DIR, "index.tsx");

/**
 * Convert file name to PascalCase component name
 * Examples:
 * - alert_fill.svg -> AlertFill
 * - check_circle.svg -> CheckCircle
 * - chevron-right.svg -> ChevronRight
 * - empty.svg -> EmptyIcon
 */
function toPascalCase(fileName) {
  // Remove .svg extension
  const nameWithoutExt = fileName.replace(/\.svg$/, "");

  // Split by underscore or hyphen
  const parts = nameWithoutExt.split(/[_-]/);

  // Capitalize first letter of each part and join
  const pascalCase = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");

  // Special case: if name is just "empty", make it "EmptyIcon"
  if (pascalCase === "Empty") {
    return "EmptyIcon";
  }

  return pascalCase;
}

/**
 * Generate icon exports from SVG files
 */
function generateIconExports() {
  try {
    // Read all files in icons directory
    const files = fs.readdirSync(ICONS_DIR);

    // Filter only SVG files, exclude index.tsx, ProfileIcons.tsx, and logo_home.svg
    const svgFiles = files.filter(
      (file) =>
        file.endsWith(".svg") &&
        file !== "index.tsx" &&
        file !== "ProfileIcons.tsx" &&
        file !== "logo_home.svg" &&
        file !== "logo_dark.svg"
    );

    // Sort alphabetically for consistent output
    svgFiles.sort();

    // Generate export statements
    const exports = svgFiles.map((file) => {
      const componentName = toPascalCase(file);
      return `export { default as ${componentName} } from "./${file}";`;
    });

    // Write to index.tsx
    const content = exports.join("\n") + "\n";
    fs.writeFileSync(INDEX_FILE, content, "utf8");

    console.log(`✅ Generated ${svgFiles.length} icon exports in index.tsx`);
    console.log(`📝 Files processed:`);
    svgFiles.forEach((file) => {
      const componentName = toPascalCase(file);
      console.log(`   - ${file} -> ${componentName}`);
    });
  } catch (error) {
    console.error("❌ Error generating icon exports:", error.message);
    process.exit(1);
  }
}

// Run the script
generateIconExports();
