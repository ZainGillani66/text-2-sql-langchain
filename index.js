require('dotenv').config();

const express = require('express');
const { ChatOpenAI } = require("@langchain/openai");
const { createSqlQueryChain } = require("langchain/chains/sql_db");
const { SqlDatabase } = require("langchain/sql_db");
const { DataSource } = require("typeorm");
const { QuerySqlTool } = require("langchain/tools/sql");
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

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

    const llm = new ChatOpenAI({ model: "gpt-4", temperature: 0.7, apiKey: process.env.OPENAI_API_KEY });

    const executeQuery = new QuerySqlTool(db);
    const writeQuery = await createSqlQueryChain({
        llm,
        db,
        dialect: "mysql",
        k: 10000,
    });

    return { writeQuery, executeQuery };
}

const generateHTML = async (result) => {
    const prompt = `Generate HTML code for displaying SQL query results: ${JSON.stringify(result)}`;

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 150,
                n: 1,
                stop: null,
                temperature: 0.7,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                },
            }
        );

        const htmlCode = response.data.choices[0].message.content.trim();
        return htmlCode;
    } catch (error) {
        console.error('Error generating HTML:', error.response ? error.response.data : error.message);
        return null;
    }
};

app.post('/search-prompt', async (req, res) => {
    try {
        if (!req.body.domain) {
            return res.status(400).json({ error: "Domain is required" });
        }

        const { writeQuery, executeQuery } = await initialize();

        const finalQuestion = { question: `${req.body.question} WHERE full_url LIKE ${req.body.domain}` };

        const result = await writeQuery.pipe(executeQuery).invoke(finalQuestion);

        const jsonResult = JSON.parse(result);

        const htmlContent = await generateHTML(jsonResult);

        res.json({ result: jsonResult, html: htmlContent });
    } catch (error) {
        console.error("Error in /search-prompt:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});