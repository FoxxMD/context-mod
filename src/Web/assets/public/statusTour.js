let steps = [];

steps = [
    {
        title: 'Welcome to the ContextMod (CM) Dashboard',
        intro: `
<div class="space-y-3"><div>The dashboard allows you to monitor and configure your Bot's behavior for each Subreddit it runs on.</div>
        <ul class="list-inside list-disc">
        <li><a href="/docs/webInterface.html" target="_blank">Dashboard Tips</a></li>
        <li><a href="/docs/subreddit-configuration" target="_blank">Config Docs</a></li>
        <li><a href="https://github.com/FoxxMD/context-mod/issues" target="_blank">Report Issue</a></li>
        <li><a href="https://www.reddit.com/r/ContextModBot/" target="_blank">CM Subreddit</a></li>
        <li><a href="https://discord.gg/YgehbC8pXW" target="_blank">CM Discord</a></li>
        </ul>
</div>`
    },
    {
        element: document.querySelector('#help'),
        intro: 'If you need a refresher of this guide you can click here to re-run it.'
    },
    {
        element: document.querySelector('#botTabs'),
        title: 'Bots List',
        intro: 'All of the bot accounts that moderate a subreddit you also moderate are listed here'
    }
];

const bot = document.querySelector('#botTabs li span:not([data-bot="system"])');
if (bot !== null) {
    steps.push({
        element: bot,
        intro: `
        <div class="space-y-3">
            <div>Click on a Bot tab to view all of the Subreddits it is running.</div>
        </div>`
    });
} else {
    steps.push({
        element: document.querySelector('#botTabs'),
        intro: `
        <div class="space-y-3">
            <div>Once a Bot account has been added it will be visible here.</div>
        </div>`
    });
}

if(window.isOperator) {
    steps.push({
        element: document.querySelector('#botTabs li:last-child'),
        title: 'Add A Bot',
        intro: `
        <div class="space-y-3">
            <div>Start the invite process for adding a new Bot</div>
        </div>`
    });
}

const nonSystemSub = document.querySelector('.sub:not([data-bot="system"])');

if(nonSystemSub === null) {
    steps.push({
        element: document.querySelector('.sub'),
        intro: `
        <div class="space-y-3">
            <div>After you have added a Bot with a moderated Subreddit re-run this tour to finish!</div>
        </div>`
    });
} else {
    const subTab = document.querySelector('#subredditsTab ul');

    steps.push({
        element: subTab,
        title: 'Subreddits List',
        intro: `
        <div class="space-y-3">
            <div>Displays all of the Subreddits run by the selected Bot</div>
            <div>${window.isOperator ? 'As an operator you can see all Subreddits even if you are not a moderator. Otherwise you would only be able to see Subreddits you moderate.' : 'You can only view Subreddits that you are also a moderator of.'}</div>
        </div>`
    });

    const allSub = document.querySelector('#subredditsTab li span[data-subreddit="All"]');
    steps.push({
        element: allSub !== null ? allSub : subTab,
        intro: `
        <div class="space-y-3">
            <div><strong>All Subreddits</strong> displays an Overview of all Subreddits you have access to as well as some basic Bot information.</div>
        </div>`
    });

    const notAllSub = document.querySelector('#subredditsTab li span:not([data-subreddit="All"])');
    steps.push({
        element: notAllSub !== null ? notAllSub : subTab,
        title: 'Subreddit',
        intro: `
        <div class="space-y-3">
            <div>Clicking on an individual Subreddit will switch to its overview/logs.</div>
            <div><strong>Please click on this Subreddit now before continuing the tour!</strong></div>
        </div>`
    });

    const activeSub = document.querySelector('.sub:not([data-subreddit="All"])');

    steps.push({
        element: activeSub,
        position: 'top',
        title: 'Subreddit View',
        intro: `
        <div class="space-y-3">
            <div>Information for the currently selected subreddit from the <strong>Subreddit List</strong> is displayed here.</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.overviewContainer'),
        title: 'Overview',
        intro: `
        <div class="space-y-3">
            <div><strong>Overview</strong> displays the current state of the Bot on this Subreddit.</div>
            <div>You may also start/stop/pause the Bot, for this Subreddit from here.</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.overviewContainer .pollingInfo'),
        intro: `
        <div class="space-y-3">
            <div>When <strong>Events</strong> is <strong>running</strong> the Bot is watching these sources, defined in your configuration, for new Activities in your subreddit.</div>
            <div>When it sees a new Activity it automatically processes it using the Runs/Checks from its configuration.</div>
            <div>This is a list of the sources the Bot is watching. Abbreviations:</div>
            <ul class="list-inside list-disc">
                <li>UNMODERATED - unmoderated mod queue</li>
                <li>MODQUEUE - modqueue</li>
                <li>NEWCOMM - new comments</li>
                <li>NEWSUB - new submissions</li>
            </ul>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.configContainer'),
        title: 'Config',
        intro: `
        <div class="space-y-3">
            <div><strong>Config</strong> displays information about this Subreddit's configuration.</div>
            <div>A Subreddit's configuration is what determines how the Bot behaves. The Bot <strong>will not run</strong> if its configuration is empty or invalid.</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.configContainer .dryRunLabel'),
        title: 'Dry Run',
        intro: `
        <div class="space-y-3">
            <div><strong>Dry Run</strong> status determines if the Bot is running in "pretend" mode or not.</div>
            <div>In Dry Run mode the Bot will check Activities normally but <strong>will not</strong> run any Actions when triggered.</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.configContainer .openConfig'),
        title: 'Config Editor',
        intro: `
        <div class="space-y-3">
            <div><strong>View</strong> opens the <strong>Configuration Editor</strong> for this subreddit.</div>
            <div>You can view/create/edit your Subreddit's configuration from the Editor.</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.usageContainer'),
        title: 'Usage',
        intro: `
        <div class="space-y-3">
            <div>Displays statistics about what the Bot has done on your Subreddit.</div>
            <div><strong>Events</strong> are the number of Comments/Submissions the Bot has checked, in total.</div>
            <div><strong>Actions</strong> are individual actions the Bot has taken in response to triggered Checks. This is usually things like removals, reporting, commenting, etc...</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.usageContainer .openActioned'),
        intro: `
        <div class="space-y-3">
            <div>Opens a new page where you can see past Actions the Bot has taken, as well as search by permalink. This is equivalent to <strong>Mod Log</strong> on Reddit.</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.runBotOnThing'),
        title: 'Manually Running the Bot',
        intro: `
        <div class="space-y-3">
            <div>You may <strong>manually run</strong> the Bot on any Activity (Submission/Comment) using its permalink.</div>
            <div>To be clear -- the Bot automatically runs on new Activities from the Subreddit. This is for when you want to re-run or manually run on an arbitrary Activity.</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.runBotOnThing input'),
        intro: `
        <div class="space-y-3">
            <div>Copy the permalink (URL) for a Submission/Comment and paste it here</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.runBotOnThing a.dryRunCheck'),
        intro: `
        <div class="space-y-3">
            <div><strong>Dry Run</strong> means the bot will check the Activity normally but <strong>will not run Actions.</strong></div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.runBotOnThing a.runCheck'),
        intro: `
        <div class="space-y-3">
            <div>Otherwise use <strong>Run</strong> to run the Bot normally.</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('.logs'),
        intro: `
        <div class="space-y-3">
            <div>A <strong>real-time</strong> stream of logs for this Subreddit.</div>
            <div>This shows a detailed stream of events and internal details for what the bot is doing.</div>
        </div>`
    });

    steps.push({
        element: activeSub.querySelector('span.has-tooltip'),
        title: 'More Help',
        intro: `
        <div class="space-y-3">
            <div>Make sure to hover over any <strong>?</strong> symbols you see as these contain more helpful information!</div>
        </div>`
    });

    steps.push({
        title: 'Good Luck!',
        intro: `This concludes the tour. Remember you can always click <strong>Tour</strong> at any time to replay this guide. Happy botting!`
    });

}


let intro = introJs().setOptions({
    steps,
})

document.querySelector('#helpStart').addEventListener('click', (e) => {
    e.preventDefault();
    intro.start();
});
