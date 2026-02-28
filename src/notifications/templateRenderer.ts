import Handlebars from "handlebars";
import fs from "node:fs";
import path from "node:path";

const TEMPLATE_SEPARATOR = "\n---\n";

export class TemplateRenderer {
  private templates: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(templatesDir: string) {
    this.loadTemplates(templatesDir);
  }

  /** Render a named template with the given data context */
  render(
    name: string,
    data: Record<string, unknown>
  ): { subject: string; body: string } {
    const template = this.templates.get(name);
    if (!template) {
      const available = [...this.templates.keys()].join(", ");
      throw new Error(
        `Template "${name}" not found. Available: ${available}`
      );
    }

    const output = template(data);
    const separatorIndex = output.indexOf(TEMPLATE_SEPARATOR);

    if (separatorIndex === -1) {
      throw new Error(
        `Template "${name}" is missing the --- separator between subject and body`
      );
    }

    const subject = output.slice(0, separatorIndex).trim();
    const body = output.slice(separatorIndex + TEMPLATE_SEPARATOR.length);

    // Clean up any double blank lines left by Handlebars conditional blocks
    const cleanBody = body.replace(/\n{3,}/g, "\n\n").trim();

    return { subject, body: cleanBody };
  }

  /** Get the list of loaded template names */
  getTemplateNames(): string[] {
    return [...this.templates.keys()];
  }

  private loadTemplates(templatesDir: string): void {
    if (!fs.existsSync(templatesDir)) {
      throw new Error(`Templates directory not found: ${templatesDir}`);
    }

    const files = fs.readdirSync(templatesDir);
    const hbsFiles = files.filter((f) => f.endsWith(".hbs"));

    if (hbsFiles.length === 0) {
      throw new Error(
        `No .hbs template files found in ${templatesDir}`
      );
    }

    for (const file of hbsFiles) {
      const filePath = path.join(templatesDir, file);
      const source = fs.readFileSync(filePath, "utf-8");
      const name = file.replace(/\.hbs$/, "");
      this.templates.set(name, Handlebars.compile(source));
    }

    console.log(
      `[notification] Loaded ${hbsFiles.length} email templates: ${hbsFiles.join(", ")}`
    );
  }
}
