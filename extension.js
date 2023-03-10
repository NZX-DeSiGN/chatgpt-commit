const vscode = require("vscode")
const { Configuration, OpenAIApi } = require("openai")
const { exec } = require("child_process")
const extension = "chatgpt-commit"

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    addCommand("setApiKey", context, async () => {
        let message = await inputUser("Enter the ChatGPT API key")

        if (!message) {
            vscode.window.showInformationMessage("Aborded, no API key provided")
            return false
        }

        const config = vscode.workspace.getConfiguration(extension)
        await config.update("chatGptApikey", message, vscode.ConfigurationTarget.Global).catch((err) => {
            console.error("Error updating setting:", err)
        })
    })

    addCommand("setProjectKeywords", context, async () => {
        if (!isWorkspace()) {
            return
        }

        await updateKeywords()
    })

    addCommand("commitChatGpt", context, async () => {
        if (!isWorkspace()) {
            return
        }

        let config = vscode.workspace.getConfiguration(extension)
        let apiKey = config.get("chatGptApikey")

        if (!apiKey) {
            apiKey = await updateApiKey()
        }

        if (!apiKey) {
            vscode.window.showInformationMessage("Commit aborded, you should provide set an API key")
            return
        }

        let cwd = getCwd()
        let keywords = config.get("keywords")
        let diff = await getGitDiff(cwd)

        if (!diff) {
            vscode.window.showInformationMessage("No stagged files")
            return
        }

        if (!keywords && !(await updateKeywords(config))) {
            return
        }

        let message = await inputUser("Enter a commit message")

        if (!message) {
            vscode.window.showInformationMessage("Commit aborded, you should provide a base commit message")
            return
        }

        let configuration = new Configuration({ apiKey })
        let client = new OpenAIApi(configuration)
        let response = await getAiCommitMessage(client, keywords, message, diff)

        try {
            await commit(cwd, response)
            vscode.commands.executeCommand("git.refresh")
        } catch (e) {
            vscode.window.showInformationMessage(e.message)
        }
    })
}

function deactivate() {}

let addCommand = (id, context, callback) => {
    let command = vscode.commands.registerCommand(`${extension}.${id}`, callback)
    context.subscriptions.push(command)
}

let inputUser = (prompt) => {
    return vscode.window.showInputBox({ prompt })
}

let isWorkspace = () => {
    const workspaceFolders = vscode.workspace.workspaceFolders
    const isWorkspace = workspaceFolders && workspaceFolders.length

    if (!isWorkspace) {
        vscode.window.showInformationMessage("You need to open a workspace before")
    }
    return isWorkspace
}

let getCwd = () => {
    const folders = vscode.workspace.workspaceFolders

    return folders[0].uri.fsPath
}

let updateApiKey = async () => {
    let message = await inputUser("Enter the ChatGPT API key")

    if (!message) {
        vscode.window.showInformationMessage("Aborded, no API key provided")
        return false
    }

    const config = vscode.workspace.getConfiguration(extension)
    await config.update("chatGptApikey", message, vscode.ConfigurationTarget.Global).catch((err) => {
        console.error("Error updating setting:", err)
    })

    return message
}
let updateKeywords = async () => {
    let config = vscode.workspace.getConfiguration(extension)
    let message = await inputUser("Enter a list of project keywords separated by spaces (saved in workspace)")

    if (!message) {
        vscode.window.showInformationMessage("Aborded, no keywords provided")
        return false
    }

    await config.update("keywords", message, vscode.ConfigurationTarget.Workspace).catch((err) => {
        console.error("Error updating setting:", err)
    })

    return true
}

let getGitDiff = (cwd) => {
    return new Promise((resolve, reject) => {
        const gitDiffCommand = "git diff --cached --name-status"
        exec(gitDiffCommand, { cwd }, (error, stdout, stderr) => {
            if (error) {
                reject(error)
            }

            if (stderr) {
                reject(new Error(stderr))
            }

            resolve(stdout.trim())
        })
    })
}

let commit = (cwd, message) => {
    return new Promise((resolve, reject) => {
        const gitDiffCommand = `git commit -e -m "${message}"`

        exec(gitDiffCommand, { cwd }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Error running "${gitDiffCommand}": ${error.message}`))
            }

            if (stderr) {
                reject(new Error(`"${gitDiffCommand}" returned error output: ${stderr}`))
            }

            resolve(stdout.trim())
        })
    })
}
let getAiCommitMessage = async (client, keywords, subject, diff) => {
    const completion = await client.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
            {
                role: "system",
                content:
                    "As a professional web developer, require project keywords, subject, Git diff as input and generate a commit message using following template\n[type]: [Concise commit message]\n\n[Bullet list commit summary]\n\nTypes: fix feat build chore docs style refactor",
            },
            {
                role: "user",
                content: `Keywords : ${keywords}\nSubject : ${subject}\nDiff :\n${diff}`,
            },
        ],
    })

    return completion.data.choices[0].message.content
}

module.exports = {
    activate,
    deactivate,
}
