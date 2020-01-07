TEXT runtime.main(SB) /usr/local/Cellar/go/1.11.1/libexec/src/runtime/proc.go
  proc.go:110		0x10233f0		65488b0c2530000000	MOVQ GS:0x30, CX				
  proc.go:110		0x10233f9		483b6110		CMPQ 0x10(CX), SP				
  proc.go:110		0x10233fd		0f8637030000		JBE 0x102373a					
  proc.go:110		0x1023403		4883ec40		SUBQ $0x40, SP					
  proc.go:110		0x1023407		48896c2438		MOVQ BP, 0x38(SP)				
  proc.go:110		0x102340c		488d6c2438		LEAQ 0x38(SP), BP				
  proc.go:111		0x1023411		65488b042530000000	MOVQ GS:0x30, AX				
  proc.go:111		0x102341a		4889442430		MOVQ AX, 0x30(SP)				
  proc.go:115		0x102341f		488b4830		MOVQ 0x30(AX), CX				
  proc.go:115		0x1023423		488b09			MOVQ 0(CX), CX					
  proc.go:115		0x1023426		48c7813001000000000000	MOVQ $0x0, 0x130(CX)				
  proc.go:121		0x1023431		48c705243d090000ca9a3b	MOVQ $0x3b9aca00, runtime.maxstacksize(SB)	
  proc.go:127		0x102343c		c6054d260b0001		MOVB $0x1, runtime.mainStarted(SB)		
  proc.go:130		0x1023443		488d0d96be0400		LEAQ go.func.*+452(SB), CX			
  proc.go:130		0x102344a		48890c24		MOVQ CX, 0(SP)					
  proc.go:130		0x102344e		e81d340200		CALL runtime.systemstack(SB)			
  proc.go:3613		0x1023453		65488b042530000000	MOVQ GS:0x30, AX				
  proc.go:3613		0x102345c		488b4030		MOVQ 0x30(AX), AX				
  proc.go:3613		0x1023460		ff806c020000		INCL 0x26c(AX)					
  proc.go:3574		0x1023466		65488b042530000000	MOVQ GS:0x30, AX				
  proc.go:3575		0x102346f		488b4830		MOVQ 0x30(AX), CX				
  proc.go:3575		0x1023473		488d9160010000		LEAQ 0x160(CX), DX				
  runtime2.go:205	0x102347a		8402			TESTB AL, 0(DX)					
  runtime2.go:205	0x102347c		4889c2			MOVQ AX, DX					
  runtime2.go:205	0x102347f		48898160010000		MOVQ AX, 0x160(CX)				
  proc.go:3576		0x1023486		488d82d8000000		LEAQ 0xd8(DX), AX				
  runtime2.go:243	0x102348d		8400			TESTB AL, 0(AX)					
  proc.go:3576		0x102348f		488b4230		MOVQ 0x30(DX), AX				
  runtime2.go:243	0x1023493		488982d8000000		MOVQ AX, 0xd8(DX)				
  proc.go:143		0x102349a		488d057f6c0900		LEAQ runtime.m0(SB), AX				
  proc.go:143		0x10234a1		488b4c2430		MOVQ 0x30(SP), CX				
  proc.go:143		0x10234a6		48394130		CMPQ AX, 0x30(CX)				
  proc.go:143		0x10234aa		0f856f020000		JNE 0x102371f					
  proc.go:147		0x10234b0		e86b2f0200		CALL runtime.init(SB)				
  proc.go:148		0x10234b5		e8567c0100		CALL runtime.nanotime(SB)			
  proc.go:148		0x10234ba		48833c2400		CMPQ $0x0, 0(SP)				
  proc.go:148		0x10234bf		0f843f020000		JE 0x1023704					
  proc.go:153		0x10234c5		c644242701		MOVB $0x1, 0x27(SP)				
  proc.go:158		0x10234ca		488d442427		LEAQ 0x27(SP), AX				
  proc.go:158		0x10234cf		4889442410		MOVQ AX, 0x10(SP)				
  proc.go:154		0x10234d4		c7042408000000		MOVL $0x8, 0(SP)				
  proc.go:154		0x10234db		488d0506be0400		LEAQ go.func.*+460(SB), AX			
  proc.go:154		0x10234e2		4889442408		MOVQ AX, 0x8(SP)				
  proc.go:154		0x10234e7		e8b4d4ffff		CALL runtime.deferproc(SB)			
  proc.go:154		0x10234ec		85c0			TESTL AX, AX					
  proc.go:154		0x10234ee		0f8594010000		JNE 0x1023688					
  proc.go:162		0x10234f4		e8177c0100		CALL runtime.nanotime(SB)			
  proc.go:162		0x10234f9		488b0424		MOVQ 0(SP), AX					
  proc.go:162		0x10234fd		48890594260b00		MOVQ AX, runtime.runtimeInitTime(SB)		
  proc.go:164		0x1023504		e857dbfeff		CALL runtime.gcenable(SB)			
  proc.go:166		0x1023509		488d0510480300		LEAQ type.*+39488(SB), AX			
  proc.go:166		0x1023510		48890424		MOVQ AX, 0(SP)					
  proc.go:166		0x1023514		48c744240800000000	MOVQ $0x0, 0x8(SP)				
  proc.go:166		0x102351d		e88e07feff		CALL runtime.makechan(SB)			
  proc.go:166		0x1023522		488b442410		MOVQ 0x10(SP), AX				
  proc.go:166		0x1023527		833dc2260b0000		CMPL $0x0, runtime.writeBarrier(SB)		
  proc.go:166		0x102352e		0f8543010000		JNE 0x1023677					
  proc.go:166		0x1023534		48890555620900		MOVQ AX, runtime.main_init_done(SB)		
  proc.go:167		0x102353b		488d054b250b00		LEAQ runtime.iscgo(SB), AX			
  proc.go:167		0x1023542		803800			CMPB $0x0, 0(AX)				
  proc.go:167		0x1023545		7456			JE 0x102359d					
  proc.go:168		0x1023547		48833dc961090000	CMPQ $0x0, __cgo_thread_start(SB)		
  proc.go:168		0x102354f		0f8494010000		JE 0x10236e9					
  proc.go:172		0x1023555		48833dcb61090000	CMPQ $0x0, runtime._cgo_setenv(SB)		
  proc.go:172		0x102355d		0f846b010000		JE 0x10236ce					
  proc.go:175		0x1023563		48833dc561090000	CMPQ $0x0, runtime._cgo_unsetenv(SB)		
  proc.go:175		0x102356b		0f8442010000		JE 0x10236b3					
  proc.go:179		0x1023571		48833d9761090000	CMPQ $0x0, __cgo_notify_runtime_init_done(SB)	
  proc.go:179		0x1023579		0f8419010000		JE 0x1023698					
  proc.go:184		0x102357f		e88c410000		CALL runtime.startTemplateThread(SB)		
  proc.go:185		0x1023584		488b0585610900		MOVQ __cgo_notify_runtime_init_done(SB), AX	
  proc.go:185		0x102358b		48890424		MOVQ AX, 0(SP)					
  proc.go:185		0x102358f		48c744240800000000	MOVQ $0x0, 0x8(SP)				
  proc.go:185		0x1023598		e8f3fbfdff		CALL runtime.cgocall(SB)			
  proc.go:189		0x102359d		488b054cbd0400		MOVQ go.func.*+468(SB), AX			
  proc.go:189		0x10235a4		488d1545bd0400		LEAQ go.func.*+468(SB), DX			
  proc.go:189		0x10235ab		ffd0			CALL AX						
  proc.go:190		0x10235ad		488b05dc610900		MOVQ runtime.main_init_done(SB), AX		
  proc.go:190		0x10235b4		48890424		MOVQ AX, 0(SP)					
  proc.go:190		0x10235b8		e8d311feff		CALL runtime.closechan(SB)			
  proc.go:192		0x10235bd		c644242700		MOVB $0x0, 0x27(SP)				
  proc.go:193		0x10235c2		e879870000		CALL runtime.unlockOSThread(SB)			
  proc.go:195		0x10235c7		488d05be240b00		LEAQ runtime.isarchive(SB), AX			
  proc.go:195		0x10235ce		803800			CMPB $0x0, 0(AX)				
  proc.go:195		0x10235d1		0f8590000000		JNE 0x1023667					
  proc.go:195		0x10235d7		488d05b0240b00		LEAQ runtime.islibrary(SB), AX			
  proc.go:195		0x10235de		803800			CMPB $0x0, 0(AX)				
  proc.go:195		0x10235e1		0f8580000000		JNE 0x1023667					
  proc.go:201		0x10235e7		488b050abd0400		MOVQ go.func.*+476(SB), AX			
  proc.go:201		0x10235ee		488d1503bd0400		LEAQ go.func.*+476(SB), DX			
  proc.go:201		0x10235f5		ffd0			CALL AX						
  proc.go:210		0x10235f7		8b05df240b00		MOVL runtime.runningPanicDefers(SB), AX		
  proc.go:210		0x10235fd		85c0			TESTL AX, AX					
  proc.go:210		0x10235ff		7428			JE 0x1023629					
  proc.go:210		0x1023601		31c0			XORL AX, AX					
  proc.go:212		0x1023603		eb12			JMP 0x1023617					
  proc.go:212		0x1023605		4889442428		MOVQ AX, 0x28(SP)				
  proc.go:216		0x102360a		e8b1020000		CALL runtime.Gosched(SB)			
  proc.go:212		0x102360f		488b442428		MOVQ 0x28(SP), AX				
  proc.go:212		0x1023614		48ffc0			INCQ AX						
  proc.go:212		0x1023617		483de8030000		CMPQ $0x3e8, AX					
  proc.go:212		0x102361d		7d0a			JGE 0x1023629					
  proc.go:213		0x102361f		8b0db7240b00		MOVL runtime.runningPanicDefers(SB), CX		
  proc.go:213		0x1023625		85c9			TESTL CX, CX					
  proc.go:213		0x1023627		75dc			JNE 0x1023605					
  proc.go:219		0x1023629		8b05a5240b00		MOVL runtime.panicking(SB), AX			
  proc.go:219		0x102362f		85c0			TESTL AX, AX					
  proc.go:219		0x1023631		7516			JNE 0x1023649					
  proc.go:223		0x1023633		c7042400000000		MOVL $0x0, 0(SP)				
  proc.go:223		0x102363a		e831790100		CALL runtime.exit(SB)				
  proc.go:226		0x102363f		31c0			XORL AX, AX					
  proc.go:226		0x1023641		c70000000000		MOVL $0x0, 0(AX)				
  proc.go:226		0x1023647		ebf6			JMP 0x102363f					
  proc.go:220		0x1023649		0f57c0			XORPS X0, X0					
  proc.go:220		0x102364c		0f110424		MOVUPS X0, 0(SP)				
  proc.go:220		0x1023650		66c74424100810		MOVW $0x1008, 0x10(SP)				
  proc.go:220		0x1023657		48c744241801000000	MOVQ $0x1, 0x18(SP)				
  proc.go:220		0x1023660		e88b020000		CALL runtime.gopark(SB)				
  proc.go:220		0x1023665		ebcc			JMP 0x1023633					
  proc.go:198		0x1023667		90			NOPL						
  proc.go:198		0x1023668		e8b3dbffff		CALL runtime.deferreturn(SB)			
  proc.go:198		0x102366d		488b6c2438		MOVQ 0x38(SP), BP				
  proc.go:198		0x1023672		4883c440		ADDQ $0x40, SP					
  proc.go:198		0x1023676		c3			RET						
  proc.go:166		0x1023677		488d3d12610900		LEAQ runtime.main_init_done(SB), DI		
  proc.go:166		0x102367e		e81d510200		CALL runtime.gcWriteBarrier(SB)			
  proc.go:166		0x1023683		e9b3feffff		JMP 0x102353b					
  proc.go:154		0x1023688		90			NOPL						
  proc.go:154		0x1023689		e892dbffff		CALL runtime.deferreturn(SB)			
  proc.go:154		0x102368e		488b6c2438		MOVQ 0x38(SP), BP				
  proc.go:154		0x1023693		4883c440		ADDQ $0x40, SP					
  proc.go:154		0x1023697		c3			RET						
  proc.go:180		0x1023698		488d051fab0400		LEAQ go.string.*+13086(SB), AX			
  proc.go:180		0x102369f		48890424		MOVQ AX, 0(SP)					
  proc.go:180		0x10236a3		48c744240825000000	MOVQ $0x25, 0x8(SP)				
  proc.go:180		0x10236ac		e85fe5ffff		CALL runtime.throw(SB)				
  proc.go:180		0x10236b1		0f0b			UD2						
  proc.go:176		0x10236b3		488d05fc8c0400		LEAQ go.string.*+5398(SB), AX			
  proc.go:176		0x10236ba		48890424		MOVQ AX, 0(SP)					
  proc.go:176		0x10236be		48c744240815000000	MOVQ $0x15, 0x8(SP)				
  proc.go:176		0x10236c7		e844e5ffff		CALL runtime.throw(SB)				
  proc.go:176		0x10236cc		0f0b			UD2						
  proc.go:173		0x10236ce		488d05f6880400		LEAQ go.string.*+4395(SB), AX			
  proc.go:173		0x10236d5		48890424		MOVQ AX, 0(SP)					
  proc.go:173		0x10236d9		48c744240813000000	MOVQ $0x13, 0x8(SP)				
  proc.go:173		0x10236e2		e829e5ffff		CALL runtime.throw(SB)				
  proc.go:173		0x10236e7		0f0b			UD2						
  proc.go:169		0x10236e9		488d05fc930400		LEAQ go.string.*+7244(SB), AX			
  proc.go:169		0x10236f0		48890424		MOVQ AX, 0(SP)					
  proc.go:169		0x10236f4		48c744240819000000	MOVQ $0x19, 0x8(SP)				
  proc.go:169		0x10236fd		e80ee5ffff		CALL runtime.throw(SB)				
  proc.go:169		0x1023702		0f0b			UD2						
  proc.go:149		0x1023704		488d054e910400		LEAQ go.string.*+6585(SB), AX			
  proc.go:149		0x102370b		48890424		MOVQ AX, 0(SP)					
  proc.go:149		0x102370f		48c744240817000000	MOVQ $0x17, 0x8(SP)				
  proc.go:149		0x1023718		e8f3e4ffff		CALL runtime.throw(SB)				
  proc.go:149		0x102371d		0f0b			UD2						
  proc.go:144		0x102371f		488d05d38e0400		LEAQ go.string.*+5977(SB), AX			
  proc.go:144		0x1023726		48890424		MOVQ AX, 0(SP)					
  proc.go:144		0x102372a		48c744240816000000	MOVQ $0x16, 0x8(SP)				
  proc.go:144		0x1023733		e8d8e4ffff		CALL runtime.throw(SB)				
  proc.go:144		0x1023738		0f0b			UD2						
  proc.go:110		0x102373a		e881320200		CALL runtime.morestack_noctxt(SB)		
  proc.go:110		0x102373f		e9acfcffff		JMP runtime.main(SB)				
  :-1			0x1023744		cc			INT $0x3					
  :-1			0x1023745		cc			INT $0x3					
  :-1			0x1023746		cc			INT $0x3					
  :-1			0x1023747		cc			INT $0x3					
  :-1			0x1023748		cc			INT $0x3					
  :-1			0x1023749		cc			INT $0x3					
  :-1			0x102374a		cc			INT $0x3					
  :-1			0x102374b		cc			INT $0x3					
  :-1			0x102374c		cc			INT $0x3					
  :-1			0x102374d		cc			INT $0x3					
  :-1			0x102374e		cc			INT $0x3					
  :-1			0x102374f		cc			INT $0x3					

TEXT runtime.main.func1(SB) /usr/local/Cellar/go/1.11.1/libexec/src/runtime/proc.go
  proc.go:130		0x1045a10		65488b0c2530000000	MOVQ GS:0x30, CX			
  proc.go:130		0x1045a19		483b6110		CMPQ 0x10(CX), SP			
  proc.go:130		0x1045a1d		7631			JBE 0x1045a50				
  proc.go:130		0x1045a1f		4883ec18		SUBQ $0x18, SP				
  proc.go:130		0x1045a23		48896c2410		MOVQ BP, 0x10(SP)			
  proc.go:130		0x1045a28		488d6c2410		LEAQ 0x10(SP), BP			
  proc.go:131		0x1045a2d		488d059c9a0200		LEAQ go.func.*+948(SB), AX		
  proc.go:131		0x1045a34		48890424		MOVQ AX, 0(SP)				
  proc.go:131		0x1045a38		48c744240800000000	MOVQ $0x0, 0x8(SP)			
  proc.go:131		0x1045a41		e83a1afeff		CALL runtime.newm(SB)			
  proc.go:132		0x1045a46		488b6c2410		MOVQ 0x10(SP), BP			
  proc.go:132		0x1045a4b		4883c418		ADDQ $0x18, SP				
  proc.go:132		0x1045a4f		c3			RET					
  proc.go:130		0x1045a50		e86b0f0000		CALL runtime.morestack_noctxt(SB)	
  proc.go:130		0x1045a55		ebb9			JMP runtime.main.func1(SB)		
  :-1			0x1045a57		cc			INT $0x3				
  :-1			0x1045a58		cc			INT $0x3				
  :-1			0x1045a59		cc			INT $0x3				
  :-1			0x1045a5a		cc			INT $0x3				
  :-1			0x1045a5b		cc			INT $0x3				
  :-1			0x1045a5c		cc			INT $0x3				
  :-1			0x1045a5d		cc			INT $0x3				
  :-1			0x1045a5e		cc			INT $0x3				
  :-1			0x1045a5f		cc			INT $0x3				

TEXT runtime.main.func2(SB) /usr/local/Cellar/go/1.11.1/libexec/src/runtime/proc.go
  proc.go:154		0x1045a60		65488b0c2530000000	MOVQ GS:0x30, CX			
  proc.go:154		0x1045a69		483b6110		CMPQ 0x10(CX), SP			
  proc.go:154		0x1045a6d		7626			JBE 0x1045a95				
  proc.go:154		0x1045a6f		4883ec08		SUBQ $0x8, SP				
  proc.go:154		0x1045a73		48892c24		MOVQ BP, 0(SP)				
  proc.go:154		0x1045a77		488d2c24		LEAQ 0(SP), BP				
  proc.go:155		0x1045a7b		488b442410		MOVQ 0x10(SP), AX			
  proc.go:155		0x1045a80		803800			CMPB $0x0, 0(AX)			
  proc.go:155		0x1045a83		7509			JNE 0x1045a8e				
  proc.go:155		0x1045a85		488b2c24		MOVQ 0(SP), BP				
  proc.go:155		0x1045a89		4883c408		ADDQ $0x8, SP				
  proc.go:155		0x1045a8d		c3			RET					
  proc.go:156		0x1045a8e		e8ad62feff		CALL runtime.unlockOSThread(SB)		
  proc.go:156		0x1045a93		ebf0			JMP 0x1045a85				
  proc.go:154		0x1045a95		e8260f0000		CALL runtime.morestack_noctxt(SB)	
  proc.go:154		0x1045a9a		ebc4			JMP runtime.main.func2(SB)		
  :-1			0x1045a9c		cc			INT $0x3				
  :-1			0x1045a9d		cc			INT $0x3				
  :-1			0x1045a9e		cc			INT $0x3				
  :-1			0x1045a9f		cc			INT $0x3				

TEXT main.f1(SB) /Users/changkun/dev/go-under-the-hood/demo/4-mem/alloc/alloc.go
  alloc.go:11		0x104e020		4883ec10		SUBQ $0x10, SP		
  alloc.go:11		0x104e024		48896c2408		MOVQ BP, 0x8(SP)	
  alloc.go:11		0x104e029		488d6c2408		LEAQ 0x8(SP), BP	
  alloc.go:11		0x104e02e		48c744241800000000	MOVQ $0x0, 0x18(SP)	
  alloc.go:12		0x104e037		48c7042401000000	MOVQ $0x1, 0(SP)	
  alloc.go:13		0x104e03f		48c744241801000000	MOVQ $0x1, 0x18(SP)	
  alloc.go:13		0x104e048		488b6c2408		MOVQ 0x8(SP), BP	
  alloc.go:13		0x104e04d		4883c410		ADDQ $0x10, SP		
  alloc.go:13		0x104e051		c3			RET			
  :-1			0x104e052		cc			INT $0x3		
  :-1			0x104e053		cc			INT $0x3		
  :-1			0x104e054		cc			INT $0x3		
  :-1			0x104e055		cc			INT $0x3		
  :-1			0x104e056		cc			INT $0x3		
  :-1			0x104e057		cc			INT $0x3		
  :-1			0x104e058		cc			INT $0x3		
  :-1			0x104e059		cc			INT $0x3		
  :-1			0x104e05a		cc			INT $0x3		
  :-1			0x104e05b		cc			INT $0x3		
  :-1			0x104e05c		cc			INT $0x3		
  :-1			0x104e05d		cc			INT $0x3		
  :-1			0x104e05e		cc			INT $0x3		
  :-1			0x104e05f		cc			INT $0x3		

TEXT main.f2(SB) /Users/changkun/dev/go-under-the-hood/demo/4-mem/alloc/alloc.go
  alloc.go:16		0x104e060		65488b0c2530000000	MOVQ GS:0x30, CX			
  alloc.go:16		0x104e069		483b6110		CMPQ 0x10(CX), SP			
  alloc.go:16		0x104e06d		764c			JBE 0x104e0bb				
  alloc.go:16		0x104e06f		4883ec20		SUBQ $0x20, SP				
  alloc.go:16		0x104e073		48896c2418		MOVQ BP, 0x18(SP)			
  alloc.go:16		0x104e078		488d6c2418		LEAQ 0x18(SP), BP			
  alloc.go:16		0x104e07d		48c744242800000000	MOVQ $0x0, 0x28(SP)			
  alloc.go:17		0x104e086		488d05939f0000		LEAQ type.*+40256(SB), AX		
  alloc.go:17		0x104e08d		48890424		MOVQ AX, 0(SP)				
  alloc.go:17		0x104e091		e8cabffbff		CALL runtime.newobject(SB)		
  alloc.go:17		0x104e096		488b442408		MOVQ 0x8(SP), AX			
  alloc.go:17		0x104e09b		4889442410		MOVQ AX, 0x10(SP)			
  alloc.go:17		0x104e0a0		48c70002000000		MOVQ $0x2, 0(AX)			
  alloc.go:18		0x104e0a7		488b442410		MOVQ 0x10(SP), AX			
  alloc.go:18		0x104e0ac		4889442428		MOVQ AX, 0x28(SP)			
  alloc.go:18		0x104e0b1		488b6c2418		MOVQ 0x18(SP), BP			
  alloc.go:18		0x104e0b6		4883c420		ADDQ $0x20, SP				
  alloc.go:18		0x104e0ba		c3			RET					
  alloc.go:16		0x104e0bb		e80089ffff		CALL runtime.morestack_noctxt(SB)	
  alloc.go:16		0x104e0c0		eb9e			JMP main.f2(SB)				
  :-1			0x104e0c2		cc			INT $0x3				
  :-1			0x104e0c3		cc			INT $0x3				
  :-1			0x104e0c4		cc			INT $0x3				
  :-1			0x104e0c5		cc			INT $0x3				
  :-1			0x104e0c6		cc			INT $0x3				
  :-1			0x104e0c7		cc			INT $0x3				
  :-1			0x104e0c8		cc			INT $0x3				
  :-1			0x104e0c9		cc			INT $0x3				
  :-1			0x104e0ca		cc			INT $0x3				
  :-1			0x104e0cb		cc			INT $0x3				
  :-1			0x104e0cc		cc			INT $0x3				
  :-1			0x104e0cd		cc			INT $0x3				
  :-1			0x104e0ce		cc			INT $0x3				
  :-1			0x104e0cf		cc			INT $0x3				

TEXT main.f3(SB) /Users/changkun/dev/go-under-the-hood/demo/4-mem/alloc/alloc.go
  alloc.go:21		0x104e0d0		65488b0c2530000000	MOVQ GS:0x30, CX			
  alloc.go:21		0x104e0d9		483b6110		CMPQ 0x10(CX), SP			
  alloc.go:21		0x104e0dd		7663			JBE 0x104e142				
  alloc.go:21		0x104e0df		4883ec28		SUBQ $0x28, SP				
  alloc.go:21		0x104e0e3		48896c2420		MOVQ BP, 0x20(SP)			
  alloc.go:21		0x104e0e8		488d6c2420		LEAQ 0x20(SP), BP			
  alloc.go:22		0x104e0ed		488d05ecf60000		LEAQ type.*+62720(SB), AX		
  alloc.go:22		0x104e0f4		48890424		MOVQ AX, 0(SP)				
  alloc.go:22		0x104e0f8		e863bffbff		CALL runtime.newobject(SB)		
  alloc.go:22		0x104e0fd		488b7c2408		MOVQ 0x8(SP), DI			
  alloc.go:22		0x104e102		48897c2418		MOVQ DI, 0x18(SP)			
  alloc.go:22		0x104e107		b900008000		MOVL $0x800000, CX			
  alloc.go:22		0x104e10c		31c0			XORL AX, AX				
  alloc.go:22		0x104e10e		f348ab			REP; STOSQ AX, ES:0(DI)			
  alloc.go:23		0x104e111		488b442418		MOVQ 0x18(SP), AX			
  alloc.go:23		0x104e116		4889442410		MOVQ AX, 0x10(SP)			
  alloc.go:23		0x104e11b		e85045fdff		CALL runtime.printlock(SB)		
  alloc.go:23		0x104e120		488b442410		MOVQ 0x10(SP), AX			
  alloc.go:23		0x104e125		48890424		MOVQ AX, 0(SP)				
  alloc.go:23		0x104e129		e8224efdff		CALL runtime.printpointer(SB)		
  alloc.go:23		0x104e12e		e8bd47fdff		CALL runtime.printnl(SB)		
  alloc.go:23		0x104e133		e8b845fdff		CALL runtime.printunlock(SB)		
  alloc.go:24		0x104e138		488b6c2420		MOVQ 0x20(SP), BP			
  alloc.go:24		0x104e13d		4883c428		ADDQ $0x28, SP				
  alloc.go:24		0x104e141		c3			RET					
  alloc.go:21		0x104e142		e87988ffff		CALL runtime.morestack_noctxt(SB)	
  alloc.go:21		0x104e147		eb87			JMP main.f3(SB)				
  :-1			0x104e149		cc			INT $0x3				
  :-1			0x104e14a		cc			INT $0x3				
  :-1			0x104e14b		cc			INT $0x3				
  :-1			0x104e14c		cc			INT $0x3				
  :-1			0x104e14d		cc			INT $0x3				
  :-1			0x104e14e		cc			INT $0x3				
  :-1			0x104e14f		cc			INT $0x3				

TEXT main.f4(SB) /Users/changkun/dev/go-under-the-hood/demo/4-mem/alloc/alloc.go
  alloc.go:26		0x104e150		65488b0c2530000000	MOVQ GS:0x30, CX			
  alloc.go:26		0x104e159		488d842468fcffff	LEAQ 0xfffffc68(SP), AX			
  alloc.go:26		0x104e161		483b4110		CMPQ 0x10(CX), AX			
  alloc.go:26		0x104e165		766a			JBE 0x104e1d1				
  alloc.go:26		0x104e167		4881ec18040000		SUBQ $0x418, SP				
  alloc.go:26		0x104e16e		4889ac2410040000	MOVQ BP, 0x410(SP)			
  alloc.go:26		0x104e176		488dac2410040000	LEAQ 0x410(SP), BP			
  alloc.go:27		0x104e17e		488d7c2408		LEAQ 0x8(SP), DI			
  alloc.go:27		0x104e183		0f57c0			XORPS X0, X0				
  alloc.go:27		0x104e186		48896c24f0		MOVQ BP, -0x10(SP)			
  alloc.go:27		0x104e18b		488d6c24f0		LEAQ -0x10(SP), BP			
  alloc.go:27		0x104e190		e87bafffff		CALL runtime.duffzero(SB)		
  alloc.go:27		0x104e195		488b6d00		MOVQ 0(BP), BP				
  alloc.go:28		0x104e199		488d442408		LEAQ 0x8(SP), AX			
  alloc.go:28		0x104e19e		4889842408040000	MOVQ AX, 0x408(SP)			
  alloc.go:28		0x104e1a6		e8c544fdff		CALL runtime.printlock(SB)		
  alloc.go:28		0x104e1ab		488b842408040000	MOVQ 0x408(SP), AX			
  alloc.go:28		0x104e1b3		48890424		MOVQ AX, 0(SP)				
  alloc.go:28		0x104e1b7		e8944dfdff		CALL runtime.printpointer(SB)		
  alloc.go:28		0x104e1bc		e82f45fdff		CALL runtime.printunlock(SB)		
  alloc.go:29		0x104e1c1		488bac2410040000	MOVQ 0x410(SP), BP			
  alloc.go:29		0x104e1c9		4881c418040000		ADDQ $0x418, SP				
  alloc.go:29		0x104e1d0		c3			RET					
  alloc.go:26		0x104e1d1		e8ea87ffff		CALL runtime.morestack_noctxt(SB)	
  alloc.go:26		0x104e1d6		e975ffffff		JMP main.f4(SB)				
  :-1			0x104e1db		cc			INT $0x3				
  :-1			0x104e1dc		cc			INT $0x3				
  :-1			0x104e1dd		cc			INT $0x3				
  :-1			0x104e1de		cc			INT $0x3				
  :-1			0x104e1df		cc			INT $0x3				

TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/4-mem/alloc/alloc.go
  alloc.go:31		0x104e1e0		65488b0c2530000000	MOVQ GS:0x30, CX			
  alloc.go:31		0x104e1e9		483b6110		CMPQ 0x10(CX), SP			
  alloc.go:31		0x104e1ed		766e			JBE 0x104e25d				
  alloc.go:31		0x104e1ef		4883ec20		SUBQ $0x20, SP				
  alloc.go:31		0x104e1f3		48896c2418		MOVQ BP, 0x18(SP)			
  alloc.go:31		0x104e1f8		488d6c2418		LEAQ 0x18(SP), BP			
  alloc.go:32		0x104e1fd		e81efeffff		CALL main.f1(SB)			
  alloc.go:32		0x104e202		488b0424		MOVQ 0(SP), AX				
  alloc.go:32		0x104e206		4889442408		MOVQ AX, 0x8(SP)			
  alloc.go:33		0x104e20b		e850feffff		CALL main.f2(SB)			
  alloc.go:33		0x104e210		488b0424		MOVQ 0(SP), AX				
  alloc.go:33		0x104e214		4889442410		MOVQ AX, 0x10(SP)			
  alloc.go:34		0x104e219		e8b2feffff		CALL main.f3(SB)			
  alloc.go:35		0x104e21e		e82dffffff		CALL main.f4(SB)			
  alloc.go:36		0x104e223		e84844fdff		CALL runtime.printlock(SB)		
  alloc.go:36		0x104e228		488b442408		MOVQ 0x8(SP), AX			
  alloc.go:36		0x104e22d		48890424		MOVQ AX, 0(SP)				
  alloc.go:36		0x104e231		e8aa4bfdff		CALL runtime.printint(SB)		
  alloc.go:36		0x104e236		e86546fdff		CALL runtime.printsp(SB)		
  alloc.go:36		0x104e23b		488b442410		MOVQ 0x10(SP), AX			
  alloc.go:36		0x104e240		48890424		MOVQ AX, 0(SP)				
  alloc.go:36		0x104e244		e8074dfdff		CALL runtime.printpointer(SB)		
  alloc.go:36		0x104e249		e8a246fdff		CALL runtime.printnl(SB)		
  alloc.go:36		0x104e24e		e89d44fdff		CALL runtime.printunlock(SB)		
  alloc.go:37		0x104e253		488b6c2418		MOVQ 0x18(SP), BP			
  alloc.go:37		0x104e258		4883c420		ADDQ $0x20, SP				
  alloc.go:37		0x104e25c		c3			RET					
  alloc.go:31		0x104e25d		e85e87ffff		CALL runtime.morestack_noctxt(SB)	
  alloc.go:31		0x104e262		e979ffffff		JMP main.main(SB)			
  :-1			0x104e267		cc			INT $0x3				
  :-1			0x104e268		cc			INT $0x3				
  :-1			0x104e269		cc			INT $0x3				
  :-1			0x104e26a		cc			INT $0x3				
  :-1			0x104e26b		cc			INT $0x3				
  :-1			0x104e26c		cc			INT $0x3				
  :-1			0x104e26d		cc			INT $0x3				
  :-1			0x104e26e		cc			INT $0x3				
  :-1			0x104e26f		cc			INT $0x3				

TEXT main.init(SB) <autogenerated>
  <autogenerated>:1	0x104e270		65488b0c2530000000	MOVQ GS:0x30, CX			
  <autogenerated>:1	0x104e279		483b6110		CMPQ 0x10(CX), SP			
  <autogenerated>:1	0x104e27d		7649			JBE 0x104e2c8				
  <autogenerated>:1	0x104e27f		4883ec08		SUBQ $0x8, SP				
  <autogenerated>:1	0x104e283		48892c24		MOVQ BP, 0(SP)				
  <autogenerated>:1	0x104e287		488d2c24		LEAQ 0(SP), BP				
  <autogenerated>:1	0x104e28b		803df077080001		CMPB $0x1, main.initdone.(SB)		
  <autogenerated>:1	0x104e292		7702			JA 0x104e296				
  <autogenerated>:1	0x104e294		eb09			JMP 0x104e29f				
  <autogenerated>:1	0x104e296		488b2c24		MOVQ 0(SP), BP				
  <autogenerated>:1	0x104e29a		4883c408		ADDQ $0x8, SP				
  <autogenerated>:1	0x104e29e		c3			RET					
  <autogenerated>:1	0x104e29f		803ddc77080001		CMPB $0x1, main.initdone.(SB)		
  <autogenerated>:1	0x104e2a6		7402			JE 0x104e2aa				
  <autogenerated>:1	0x104e2a8		eb07			JMP 0x104e2b1				
  <autogenerated>:1	0x104e2aa		e8b126fdff		CALL runtime.throwinit(SB)		
  <autogenerated>:1	0x104e2af		0f0b			UD2					
  <autogenerated>:1	0x104e2b1		c605ca77080001		MOVB $0x1, main.initdone.(SB)		
  <autogenerated>:1	0x104e2b8		c605c377080002		MOVB $0x2, main.initdone.(SB)		
  <autogenerated>:1	0x104e2bf		488b2c24		MOVQ 0(SP), BP				
  <autogenerated>:1	0x104e2c3		4883c408		ADDQ $0x8, SP				
  <autogenerated>:1	0x104e2c7		c3			RET					
  <autogenerated>:1	0x104e2c8		e8f386ffff		CALL runtime.morestack_noctxt(SB)	
  <autogenerated>:1	0x104e2cd		eba1			JMP main.init(SB)			
