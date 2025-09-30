const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Parser } = require('node-sql-parser');

// 🔹 Central Gemini JSON sanitizer
function cleanGeminiJSON(raw) {
  let text = raw.trim();

  // Remove markdown fences like ```json ... ```
  if (text.startsWith('```')) {
    text = text
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```$/, '')
      .trim();
  }

  return text;
}

class DataGenerator {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({
      model: process.env.GOOGLE_GENAI_MODEL || 'gemini-2.0-flash-001',
    });
    this.parser = new Parser();
    this.options = {
      database: 'PostgreSQL',
      multipleStatements: true,
      includeEnums: true,
    };
  }

  // ... your _processAST stays the same ...

  async _enhanceSchemaWithAI(schema, originalDDL) {
    const prompt = `
      Analyze this database schema and suggest:
      1. Realistic value ranges and patterns for each column
      2. Potential data relationships and constraints not explicitly defined
      3. Business rules that should be considered when generating data
      
      Schema:
      ${JSON.stringify(schema, null, 2)}
      
      Original DDL:
      ${originalDDL}
      
      Return the enhanced schema with your suggestions in JSON format.
      IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
    `;

    const result = await this.model.generateContent(prompt);
    const rawText = result.response.text();
    const jsonStr = cleanGeminiJSON(rawText);

    return { ...schema, suggestions: JSON.parse(jsonStr) };
  }

  async parseDDL(ddlContent) {
    try {
      const ast = this.parser.parse(ddlContent, this.options);
      const schema = this._processAST(ast);
      return await this._enhanceSchemaWithAI(schema, ddlContent);
    } catch (error) {
      console.error('Error parsing DDL:', error);

      const prompt = `
        Parse this DDL and return a JSON structure with:
        1. Table definitions
        2. Column types and constraints
        3. Relationships between tables
        
        DDL:
        ${ddlContent}

        IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
      `;

      const result = await this.model.generateContent(prompt);
      const rawText = result.response.text();
      const jsonStr = cleanGeminiJSON(rawText);

      return JSON.parse(jsonStr);
    }
  }

  async generateSyntheticData(schema, instructions, config = {}) {
    const { numRecords = 100 } = config;

    const prompt = `
      Generate synthetic data based on the following schema and instructions.
      Generate ${numRecords} records for each table while maintaining referential integrity.
      
      Schema:
      ${JSON.stringify(schema, null, 2)}
      
      Additional Instructions:
      ${instructions || 'Generate realistic and consistent data'}
      
      Return the data in JSON format with table names as keys and arrays of records as values.
      IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
    `;

    const result = await this.model.generateContent(prompt);
    const rawText = result.response.text();

    try {
      const jsonStr = cleanGeminiJSON(rawText);
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('Error parsing Gemini response:', error);
      console.error('Raw response:', rawText);
      throw new Error('Failed to parse Gemini response as JSON');
    }
  }

  async modifyGeneratedData(data, modifications) {
    const prompt = `
      Modify the following dataset according to these instructions:
      ${modifications}
      
      Current Data:
      ${JSON.stringify(data, null, 2)}
      
      Return the modified data in the same JSON format.
      IMPORTANT: Return only the JSON data without any markdown formatting or code blocks.
    `;

    const result = await this.model.generateContent(prompt);
    const rawText = result.response.text();
    const jsonStr = cleanGeminiJSON(rawText);

    return JSON.parse(jsonStr);
  }
}

module.exports = DataGenerator;
