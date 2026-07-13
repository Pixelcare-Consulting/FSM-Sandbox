import { v4 as uuid } from 'uuid';

const NavbarDefault = [
	{
		id: uuid(),
		menuitem: 'Dashboard',
		link: '/dashboard',
		icon: 'HouseDoorFill',
	},
	{
		id: uuid(),
		menuitem: 'Customers',
		link: '/#',
		icon: 'PeopleFill',
		children: [
			{
				id: uuid(),
				header: true,
				header_text: 'Customer Menu'
			},
			{
				id: uuid(),
				menuitem: 'Portal Customers',
				link: '/customer-leads',
				icon: 'PersonFill',
				badge: 'NEW'
			},
		{	
			id: uuid(),
			menuitem: 'SAP Customers',
			link: '/customers',
			icon: 'PeopleFill'
		},
		{	
			id: uuid(),
			menuitem: 'SAP Leads',
			link: '/leads',
			icon: 'PersonLinesFill'
		},
	],
	},
	{
		id: uuid(),
		menuitem: 'Technicians',
		link: '#',
		icon: 'PeopleFill',
		children: [
			{
				id: uuid(),
				header: true,
				header_text: 'Technician Menu'
			},
			
			{
				id: uuid(),
				menuitem: 'Technicians',
				link: '/workers',
				icon: 'PersonLinesFill'
			},
			// {
			// 	id: uuid(),
			// 	menuitem: 'Technicians Dispatch (OLD)',
			// 	icon: 'CalendarWeekFill'
			// },
			{
				id: uuid(),
				menuitem: 'Technicians Scheduler',
				link: '/scheduler',
				icon: 'CalendarWeekFill'
			},

			

		],
		isAuthenticated: true,
	},
	{
		id: uuid(),
		menuitem: 'Jobs',
		link: '#',
		icon: 'BriefcaseFill',
		children: [
			{
				id: uuid(),
				header: true,
				header_text: 'Jobs Menu'
			},
			{
				id: uuid(),
				menuitem: 'Jobs',
				link: '/jobs',
				icon: 'ListTask'
			},
			{
				id: uuid(),
				menuitem: 'Live tracking (BETA)',
				link: '/jobs/live-tracking',
				icon: 'GeoAlt',
				badge: 'NEW'
			},
			// {
			// 	id: uuid(),
			// 	menuitem: 'Jobs Calendar',
			// 	link: '/jobs/calendar',
			// 	icon: 'CalendarWeekFill'
			// },
		],
		isAuthenticated: true,
	},

	{
		id: uuid(),
		menuitem: 'Follow-Ups',
		link: '/follow-ups',
		icon: 'ListCheck',
	},
	{
		id: uuid(),
		menuitem: 'Memos',
		link: '/dashboard/company-memos',
		icon: 'MegaphoneFill',
		adminOnly: true,
	},
	{
		id: uuid(),
		menuitem: 'Reports',
		link: '/dashboard/reports',
		icon: 'BarChartFill',
	},
	{
		id: uuid(),
		menuitem: 'Calendar',
		icon: 'CalendarEvent',
		link: '#',
		children: [
			{
				id: uuid(),
				menuitem: 'Attendance',
				link: '/workers/attendance',
				icon: 'ClockFill',
			},
			{
				id: uuid(),
				menuitem: 'Company Calendar',
				link: '/company-calendar',
				icon: 'CalendarEvent',
			},
		],
	},
	{
		id: uuid(),
		menuitem: "Release Notes",
		link: '/dashboard/whats-new',
		icon: 'JournalRichtext',
		alignEnd: true,
	},
];

//console.log('NavbarDefault:', JSON.stringify(NavbarDefault, null, 2));

export default NavbarDefault;
