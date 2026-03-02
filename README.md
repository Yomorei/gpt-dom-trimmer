## Pasted From my Reddit Reply bc I couldn't be bothered to re-write this.

So I was actually bored and one of my friends had basically the same issue and told me to "make a fix" lol. So I made a simple tamper monkey script with a simple UI, NOT intrusive XD. 

### 1) Why I made it
-------
Also I mainly made this in spite of AI Workspace as it genuinely pissed me off with the STUPID monetization, EXTREMELY INTRUSIVE and annoying UI and so on. (Thanks to my friend for have shown me this) Also who doesn't like a simple fix for the poor poor choices of the "developers" over at OpenAI. It baffles my mind that they either ignored these performance issues or just didn't care. (would've been super easy to implement a simple fix so that your long vibe coding sessions keeps DOM healthy..) 

### 2) Don't listen to morons who think their smart and know everything 
-------------------------------------------------------------------------
Also(x2) to people saying to use the app version of ChatGPT don't listen those idiots because the app is literally an electron wrapper LOL (ask chat-gpt if you dk 💀), it's not going to change anything performance wise. 💀💀  

Also(x3) don't listen to people telling you to change your agents memory and so on, they don't understand anything of the real issues. 

### 3) "Technical" part
--------------------
Also(x4) 💀 I guess I'll get a bit technical on why not to listen to these morons XD. So basically why the chat seems to get VERY lagy when in long ass convos is because the page ends up with a huge DOM tree because the UI keeps many and MOST message turns mounted at once (which is REALLY stupid) SO large DOMs make scrolling, layout, paint, selection, and incremental updates slow as shit.  

Also(x5) Chat output with gpt is actually really rich because you have markdown, code blocks, syntax highlighting, images and so on so each turn can expand to lots of nodes, multiply that by hundreds/thousands of turns and you get heavy main-thread work XD. I don't really wanna explain more, but I hope you get the point if not just ask chat-gpt 💀😂  
