require('dotenv').config();
const express = require('express');
const { ChatOpenAI } = require("@langchain/openai");
const { createSqlQueryChain } = require("langchain/chains/sql_db");
const { SqlDatabase } = require("langchain/sql_db");
const { DataSource } = require("typeorm");
const { QuerySqlTool } = require("langchain/tools/sql");
const { PromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { RunnablePassthrough, RunnableSequence } = require("@langchain/core/runnables");

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

    await datasource.initialize(); 

    const db = await SqlDatabase.fromDataSourceParams({
        appDataSource: datasource,
    });

    const llm = new ChatOpenAI({ model: "gpt-4", temperature: 0.7, apiKey: process.env.OPENAI_API_KEY });

    const executeQuery = new QuerySqlTool(db);
    const writeQuery = await createSqlQueryChain({
        llm,
        db,
        dialect: "mysql",
        k: 10000
    });

    const answerPrompt = PromptTemplate.fromTemplate(`Given the following user question, corresponding SQL query , and SQL result, answer the user question.
    
    Question: {question}
    SQL Query: {query}
    SQL Result: {result}
    Answer: `);

    const answerChain = answerPrompt.pipe(llm).pipe(new StringOutputParser());

    const chain = RunnableSequence.from([
        RunnablePassthrough.assign({ query: writeQuery }).assign({
            result: (i) => executeQuery.invoke(i.query),
        }),
        answerChain,
    ]);

    return chain;
}

app.post('/search-prompt', async (req, res) => {
    try {
        if (!req.body.question || !req.body.domain) {
            return res.status(400).json({ error: "Question and domain are required" });
        }

        const chain = await initialize();

        const finalQuestion = {
            question: `${req.body.question} WHERE full_url LIKE '%${req.body.domain}%'`
        };

        const result = await chain.invoke(finalQuestion);

        const htmlResponse = `
            <html>
            <head>
                <title>Query Result</title>
            </head>
            <body>
                <h1>Query Result</h1>
                <p><strong>Question:</strong> ${req.body.question}</p>
                <p><strong>Answer:</strong> ${result}</p>
            </body>
            </html>
        `;

        res.send(htmlResponse);
    } catch (error) {
        console.error("Error in /search-prompt:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});