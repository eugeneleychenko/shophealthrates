# misha 2

**Meeting Date:** 13th May, 2026 - 2:58 PM

---

**Josh Goins** *[00:01]*: Nice to meet you. 
**Mikhail Andreyev** *[00:03]*: Eugene is actually my wife's favorite cousin, and he's a tech genius. And. Yeah, he's been helping me out with. 
**Josh Goins** *[00:15]*: These,. 
**Mikhail Andreyev** *[00:18]*: You know, with the connections. 
**Josh Goins** *[00:21]*: Nice, nice. So. 
**Mikhail Andreyev** *[00:25]*: Eugene's not familiar with the marketing side of things. 
**Josh Goins** *[00:32]*: So,. 
**Mikhail Andreyev** *[00:36]*: Eugene, what we're trying to do. And Josh Stephan, and correct me, once a lead comes in, it comes in with a click ID that gets transferred by Google. Correct. 
**Josh Goins** *[00:51]*: You may start here. I'll start from the beginning. So, all right, so we have. We have Google, we have our tracker, Click Flare. So the start of it, we set up the campaigns in clickflare. Clickflare. When we place that link in Google, it passes Google Click ID and also a clickflare click id. And from there those get passed into the utm. So we would need those utms passed into the CRM. The CRM would then fire the conversion to qlikflare, matching that qlikid, and then clickflare handles the API to Google for conversion tracking. And they would match on their end based on the Google Click ID that's stored with that Qlik ID of theirs, if that makes sense. 
**Eugene Leychenko** *[01:50]*: And to confirm these people are coming in from a Google paid ad. 
**Josh Goins** *[01:55]*: Yep, correct. 
**Eugene Leychenko** *[01:56]*: So then that UTM parameter needs to be passed through to the URL of the site. Okay. Yeah. 
**Josh Goins** *[02:06]*: So as long as all the UTMs are passed into the CRM, I think it should be fine to be able to post those back. And as for Ringba. Ringba, I mean, it automatically grabs all those every UTM based on the page, and they have. They have docs on their side for the scripts and stuff like that. For Google tracking, since it is no redirect, Google tracking with clickflare is no redirect tracking. So there's a script you place within the site, and it grabs those through that. 
**Mikhail Andreyev** *[02:47]*: Mm. 
**Josh Goins** *[02:49]*: Okay. 
**Mikhail Andreyev** *[02:51]*: So reporting back. So, and then once a sale is confirmed, an agent hits the sale disposition. Well, we'll. Which should trigger like a web hook to go into Bobberdo. And that. The question that. 
**Josh Goins** *[03:15]*: I don't know if. 
**Mikhail Andreyev** *[03:18]*: No, no. And then Bobber would then send it back to clickflare. 
**Josh Goins** *[03:26]*: Yeah, so I guess, like, if. If they. If they mark that disposition as a sale and it updates in, you're the CRM. I'm assuming the CRM contact card has the click ID stored with the contact. So when it gets updated, then it would ping in as a cell to that click id. Yeah, that makes sense. 
**Mikhail Andreyev** *[03:49]*: I get it. I get it, eugene. You get it? Yes. 
**Eugene Leychenko** *[03:54]*: So. So I basically. Yeah. So I think for me, my end, I just need to be able to receive a UTM parameters and also pat. And then make sure that they persist throughout the session of the user. 
**Josh Goins** *[04:08]*: Correct. And. And it's all stored into the. The CRM. 
**Eugene Leychenko** *[04:13]*: Yep. And then to the CRM. Actually, I'm writing to the right to the Baburdu CRM. I am successfully writing to that. I assume we have fields for the. For all those UTM parameters in the CRM for it to be accepted. Is that right, Mike? 
**Mikhail Andreyev** *[04:30]*: Say that again. 
**Eugene Leychenko** *[04:33]*: Are there fields in the CRM that we would like? For instance, you told me that like phone number or income wasn't coming over. Do we have fields for. 
**Mikhail Andreyev** *[04:45]*: Yeah, I'm checking. Yeah. So there's definitely a field. I'll. Let me share my screen. So let's say from like healthcare.com this is. This is what we get right here, Lead ID token. And this is what they're constantly bugging us about. So I'm assuming that's the. That's how they're tracking it. 
**Eugene Leychenko** *[05:23]*: Yep. 
**Mikhail Andreyev** *[05:27]*: Let me see if it shows up on the actual. 
**Josh Goins** *[05:30]*: Because we have. 
**Mikhail Andreyev** *[05:31]*: Because it travels through 2 CRMs from. From Bobber to it. It goes into our dialer, which is essentially a CRM as well. Let me just share the dialer. Let me see if anybody's on it. 
**Eugene Leychenko** *[05:55]*: Yep. 
**Mikhail Andreyev** *[06:03]*: I don't see it on the dollar, but it's in there. As long as it's in Bobber though, it'll match it. It'll match it back. 
**Josh Goins** *[06:11]*: Yeah. As long as they update that same contact card. Yeah, yeah, I think it would. It would post back. 
**Eugene Leychenko** *[06:18]*: Yep, it will. 
**Mikhail Andreyev** *[06:19]*: It will, yeah. So we do have a person that works on our dialer. Maybe I will. Let me reach out to her, see if she can create a web hook between for the sale disposition and. Yeah, the sale disposition and Bobberdoo. Here, let me show you. These are the only dispositions we have in Bob. I mean, essentially, I think we just need sale because these are the. These are the. The working lead doc. Send doc sign process and closed. Dead. I think we just need to close. 
**Josh Goins** *[07:11]*: Yeah. So I mean, what. How envision it because when we first start off, we'll probably fire our main conversion event to Google will probably be unqualified leads just because those come in a lot faster. There's a lot more. And that helps Google dial in on what we're kind of looking for. And then at the same time, we'll have a secondary conversion event in Google that will fire on the sales. And while those Qualified leads are building up pixel data as a secondary conversion. There's sales data reporting in there. And then eventually what the goal is we'll set up second campaigns or switch campaigns over to that cell event, if that makes sense. 
**Mikhail Andreyev** *[07:56]*: Yeah, yeah, yep. Is there any way to. Is there anywhere. Is there any way Google can ingest like a CSV file? 
**Josh Goins** *[08:06]*: Yeah, I mean, we could feed it as well. We can feed it lookalike audiences as well. If you have like their full name, address, phone number, email, we can feed that as an audience and then create campaigns based off those audiences as well. That would help. 
**Mikhail Andreyev** *[08:23]*: Yeah. I mean, we can gather like, close sales. 
**Josh Goins** *[08:27]*: Yeah. 
**Mikhail Andreyev** *[08:28]*: And yeah. So the reason why I asked that question is what we can do while the campaign is learning. I can manually listen to calls, check connection rates. Listen, not everybody's gonna close, but some people are legitimately looking for health insurance. So I can kind of separate the ones that are legitimate calls. We just didn't close them or leads from the trash and then kind of manually feed it that way to kind of speed up the process. 
**Josh Goins** *[09:06]*: Yeah, yeah. We just need to build up the pixel data. It's just kind of like always like to start off on the smaller conversion event first, and then it just. As you get scaled, you know, you just keep beating it data. Because. Because the thing is like when you start campaigns off of. And it's like a big conversion event that it's waiting for and it doesn't see anything. It's just constantly trying to test different pockets of audiences and it doesn't know what it's looking for. You know, and if a sales valued at like a high number, dollar amount, you know, you would. It would take big budgets to be able to, you know, feed that really fast. 
**Mikhail Andreyev** *[09:48]*: Yep, I got it. All right, so I'll compile some. So what do we need the names, address names, phone numbers and emails for the. 
**Josh Goins** *[09:59]*: That should be fine. Name, phone number, email should be enough. Maybe even zip code. Yeah. For a look. I like audience. Yep. 
**Mikhail Andreyev** *[10:13]*: Yeah, I mean, we can ask. We can ask Joe, see what he needs. 
**Josh Goins** *[10:21]*: I was looking at this bobber do. It does look like they. They do have tracking pixels and stuff like that. They don't nutm tracking source attribution. But so for the clickflare. So pretty much whenever valid leads and sales come in, we just post a web hook back and make sure clickflare will have like a postback URL and we pass the. The clickflare click ID back to them and that's how it matches Everything Gotcha with, we can pass it either as a lead or a sale depending on, you know, you can have multiple conversion events in there and we can even pass back values as well. Got it. 
**Mikhail Andreyev** *[11:19]*: All right, but, okay, cool. All right, so let me try to get the dialer to disposition the sales into Bobberdo and then. 
**Josh Goins** *[11:38]*: Okay, we'll figure. Yeah, there's a lot of moving parts here. This is like a lot of connection to a connection to. Yeah, connection. I think we just have to, you know, mark them off our list one at a time. 
**Eugene Leychenko** *[11:50]*: Yep. 
**Mikhail Andreyev** *[11:51]*: So all right, let me start on that connection and then from Bobber to the click tracker. Okay. 
**Josh Goins** *[12:06]*: And, and so, so when you do go to set up Clickflare, if you need help, let me know. But it is non redirect tracking for Google because they don't like redirects so it has to be non redirect tracking. 
**Mikhail Andreyev** *[12:20]*: So I, I, I set it up already. Can I, is there like, I gotta check. Maybe there's like. 
**Josh Goins** *[12:28]*: I can invite you as a user that that's the next plan up. So you would have, you'd have to upgrade the plan if you wanted to have multi user. 
**Mikhail Andreyev** *[12:40]*: Okay, I'll delete my credentials. That's fine. 
**Josh Goins** *[12:42]*: Okay. Yeah, yeah. I mean there's nothing, it's just been tracking and. 
**Eugene Leychenko** *[12:47]*: Yep. 
**Josh Goins** *[12:48]*: Conversion posting other than that. Yeah, I think. And then, and then on the Ringba side you'll have to look up if we are posting Ringba data back into clickflare as well. I think there's a special way you have to set up the Ringba JS tag for non redirect tracking with Google as well. Pretty sure they have docs on that now. 
**Mikhail Andreyev** *[13:14]*: Yep. 
**Eugene Leychenko** *[13:15]*: Cool. 
**Josh Goins** *[13:16]*: So. 
**Mikhail Andreyev** *[13:17]*: Alrighty. 
**Eugene Leychenko** *[13:19]*: Hey Josh, is there something I can do on my side to be able to accept or how would I be able to. I guess when you guys run the ads, is there anything you need from my side to be able to. I'm just trying to think like I, I guess you guys would be just creating those, you know, those long params. I mean Google would be creating them when someone clicks on it. Right. It would be something organic. 
**Josh Goins** *[13:53]*: So we create the campaigns and clickflare that spits out like a UTM tag that we're gonna place into Google. Google fills out those placeholder tokens on their end and then it passes into the URL. 
**Eugene Leychenko** *[14:07]*: Would you know what the structure of those would look like? That way I can start testing those. 
**Josh Goins** *[14:12]*: Make sure for click flare. Well he has the account, so we can grab it from there. If you created a campaign in there. Let me see if I can look at it real quick. 
**Mikhail Andreyev** *[14:27]*: I haven't done anything. I just created a freak. They didn't. We're like in the 14 day trial. 
**Josh Goins** *[14:32]*: Okay, but it'll be like Ann UTM campaign and UTM ad ID. You know, campaign ID ad set ID there. Look. ID should it passes under its own UTM. We'll just have to. We'll have to set up. We'll have to set up campaign in there and give you the exact. 
**Eugene Leychenko** *[14:57]*: Yeah, yeah. I think that's the only thing that's missing from my side. 
**Josh Goins** *[15:02]*: Okay, so maybe that's where we start. We. So Clickfair will have to set up in there and place the clickflare tracking tag on the main site and then we can. We can go from there, I guess, because that way you have. That way we can. We can. We can test the data back and forth between all the connections. 
**Mikhail Andreyev** *[15:34]*: Right. 
**Josh Goins** *[15:37]*: All right. 
**Mikhail Andreyev** *[15:39]*: All right, so I'll share the Qlik player logins with everybody. Okay, reading them right now. 
**Josh Goins** *[15:49]*: Did you want. Did you have telegram, eugene? 
**Eugene Leychenko** *[15:53]*: I do. 
**Josh Goins** *[15:54]*: Okay. Did you want to make a group chat with all of us so that way we're kind of like in sync here. Now you don't have to play tag either. 
**Mikhail Andreyev** *[16:05]*: Yeah, I'll make it. 
**Josh Goins** *[16:06]*: Okay. And then that way we can kind of. If you have any questions or anything like that. I try to help out as much as I can. I'm not a dev by any means, but I've been working with click trackers and you know, post bags and stuff for 15 plus years. 
**Mikhail Andreyev** *[16:34]*: Yeah. Yeah. If you ever need developer services, Eugene's. 
**Josh Goins** *[16:42]*: Use a G. Nice. 
**Eugene Leychenko** *[16:45]*: Yeah, I really admire your skill set because it's really obviously super valuable. 
**Josh Goins** *[16:57]*: Oh, I know. I've been doing it straight out of high school since 2007. 
**Eugene Leychenko** *[17:07]*: Right,. 
**Mikhail Andreyev** *[17:10]*: Cool. 
**Eugene Leychenko** *[17:12]*: So, yeah, I will get. I'll see you on the. Everyone on the. On the group chat. 
**Josh Goins** *[17:16]*: All right. I appreciate it. 
**Mikhail Andreyev** *[17:18]*: All right, thanks, guys. 
**Josh Goins** *[17:19]*: Yeah, no worries. Take care. 
