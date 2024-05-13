require('dotenv').config();

const express = require('express');
const { ChatOpenAI } = require("@langchain/openai");
const { createSqlQueryChain } = require("langchain/chains/sql_db");
const { SqlDatabase } = require("langchain/sql_db");
const { DataSource } = require("typeorm");
const { QuerySqlTool } = require("langchain/tools/sql");

const app = express();
const port = process.env.PORT;

app.use(express.json());

async function initialize() {
  const datasource = new DataSource({
    type: "mysql",
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });

  const db = await SqlDatabase.fromDataSourceParams({
    appDataSource: datasource,
  });

  const openaiApiKey = process.env.OPENAI_API_KEY;

  const llm = new ChatOpenAI({ model: "gpt-4", temperature: 0, apiKey: openaiApiKey });

  const executeQuery = new QuerySqlTool(db);
  const writeQuery = await createSqlQueryChain({
    llm,
    db,
    dialect: "mysql",
  });
  console.log("Query",executeQuery);

  return { writeQuery, executeQuery };
}

app.post('/search-prompt', async (req, res) => {
  try {
    const { writeQuery, executeQuery } = await initialize();
    const result = await writeQuery.pipe(executeQuery).invoke(req.body);
    const jsonResult = JSON.parse(result);
    res.json({ result: jsonResult });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
