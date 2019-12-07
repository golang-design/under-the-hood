TEXT runtime.main(SB) /usr/local/Cellar/go/1.11/libexec/src/runtime/proc.go
  proc.go:110		0x1023f80		65488b0c2530000000	MOVQ GS:0x30, CX				
  proc.go:110		0x1023f89		483b6110		CMPQ 0x10(CX), SP				
  proc.go:110		0x1023f8d		0f8637030000		JBE 0x10242ca					
  proc.go:110		0x1023f93		4883ec40		SUBQ $0x40, SP					
  proc.go:110		0x1023f97		48896c2438		MOVQ BP, 0x38(SP)				
  proc.go:110		0x1023f9c		488d6c2438		LEAQ 0x38(SP), BP				
  proc.go:111		0x1023fa1		65488b042530000000	MOVQ GS:0x30, AX				
  proc.go:111		0x1023faa		4889442430		MOVQ AX, 0x30(SP)				
  proc.go:115		0x1023faf		488b4830		MOVQ 0x30(AX), CX				
  proc.go:115		0x1023fb3		488b09			MOVQ 0(CX), CX					
  proc.go:115		0x1023fb6		48c7813001000000000000	MOVQ $0x0, 0x130(CX)				
  proc.go:121		0x1023fc1		48c7059491090000ca9a3b	MOVQ $0x3b9aca00, runtime.maxstacksize(SB)	
  proc.go:127		0x1023fcc		c605bd820b0001		MOVB $0x1, runtime.mainStarted(SB)		
  proc.go:130		0x1023fd3		488d0d2ef30400		LEAQ go.func.*+479(SB), CX			
  proc.go:130		0x1023fda		48890c24		MOVQ CX, 0(SP)					
  proc.go:130		0x1023fde		e86d400200		CALL runtime.systemstack(SB)			
  proc.go:3613		0x1023fe3		65488b042530000000	MOVQ GS:0x30, AX				
  proc.go:3613		0x1023fec		488b4030		MOVQ 0x30(AX), AX				
  proc.go:3613		0x1023ff0		ff806c020000		INCL 0x26c(AX)					
  proc.go:3574		0x1023ff6		65488b042530000000	MOVQ GS:0x30, AX				
  proc.go:3575		0x1023fff		488b4830		MOVQ 0x30(AX), CX				
  proc.go:3575		0x1024003		488d9160010000		LEAQ 0x160(CX), DX				
  runtime2.go:205	0x102400a		8402			TESTB AL, 0(DX)					
  runtime2.go:205	0x102400c		4889c2			MOVQ AX, DX					
  runtime2.go:205	0x102400f		48898160010000		MOVQ AX, 0x160(CX)				
  proc.go:3576		0x1024016		488d82d8000000		LEAQ 0xd8(DX), AX				
  runtime2.go:243	0x102401d		8400			TESTB AL, 0(AX)					
  proc.go:3576		0x102401f		488b4230		MOVQ 0x30(DX), AX				
  runtime2.go:243	0x1024023		488982d8000000		MOVQ AX, 0xd8(DX)				
  proc.go:143		0x102402a		488d05efc80900		LEAQ runtime.m0(SB), AX				
  proc.go:143		0x1024031		488b4c2430		MOVQ 0x30(SP), CX				
  proc.go:143		0x1024036		48394130		CMPQ AX, 0x30(CX)				
  proc.go:143		0x102403a		0f856f020000		JNE 0x10242af					
  proc.go:147		0x1024040		e8bb3b0200		CALL runtime.init(SB)				
  proc.go:148		0x1024045		e8067e0100		CALL runtime.nanotime(SB)			
  proc.go:148		0x102404a		48833c2400		CMPQ $0x0, 0(SP)				
  proc.go:148		0x102404f		0f843f020000		JE 0x1024294					
  proc.go:153		0x1024055		c644242701		MOVB $0x1, 0x27(SP)				
  proc.go:158		0x102405a		488d442427		LEAQ 0x27(SP), AX				
  proc.go:158		0x102405f		4889442410		MOVQ AX, 0x10(SP)				
  proc.go:154		0x1024064		c7042408000000		MOVL $0x8, 0(SP)				
  proc.go:154		0x102406b		488d059ef20400		LEAQ go.func.*+487(SB), AX			
  proc.go:154		0x1024072		4889442408		MOVQ AX, 0x8(SP)				
  proc.go:154		0x1024077		e8b4d4ffff		CALL runtime.deferproc(SB)			
  proc.go:154		0x102407c		85c0			TESTL AX, AX					
  proc.go:154		0x102407e		0f8594010000		JNE 0x1024218					
  proc.go:162		0x1024084		e8c77d0100		CALL runtime.nanotime(SB)			
  proc.go:162		0x1024089		488b0424		MOVQ 0(SP), AX					
  proc.go:162		0x102408d		48890504830b00		MOVQ AX, runtime.runtimeInitTime(SB)		
  proc.go:164		0x1024094		e877dbfeff		CALL runtime.gcenable(SB)			
  proc.go:166		0x1024099		488d0560670300		LEAQ type.*+40480(SB), AX			
  proc.go:166		0x10240a0		48890424		MOVQ AX, 0(SP)					
  proc.go:166		0x10240a4		48c744240800000000	MOVQ $0x0, 0x8(SP)				
  proc.go:166		0x10240ad		e8fefbfdff		CALL runtime.makechan(SB)			
  proc.go:166		0x10240b2		488b442410		MOVQ 0x10(SP), AX				
  proc.go:166		0x10240b7		833d32830b0000		CMPL $0x0, runtime.writeBarrier(SB)		
  proc.go:166		0x10240be		0f8543010000		JNE 0x1024207					
  proc.go:166		0x10240c4		48890525be0900		MOVQ AX, runtime.main_init_done(SB)		
  proc.go:167		0x10240cb		488d05bb810b00		LEAQ runtime.iscgo(SB), AX			
  proc.go:167		0x10240d2		803800			CMPB $0x0, 0(AX)				
  proc.go:167		0x10240d5		7456			JE 0x102412d					
  proc.go:168		0x10240d7		48833d99bd090000	CMPQ $0x0, __cgo_thread_start(SB)		
  proc.go:168		0x10240df		0f8494010000		JE 0x1024279					
  proc.go:172		0x10240e5		48833d9bbd090000	CMPQ $0x0, runtime._cgo_setenv(SB)		
  proc.go:172		0x10240ed		0f846b010000		JE 0x102425e					
  proc.go:175		0x10240f3		48833d95bd090000	CMPQ $0x0, runtime._cgo_unsetenv(SB)		
  proc.go:175		0x10240fb		0f8442010000		JE 0x1024243					
  proc.go:179		0x1024101		48833d67bd090000	CMPQ $0x0, __cgo_notify_runtime_init_done(SB)	
  proc.go:179		0x1024109		0f8419010000		JE 0x1024228					
  proc.go:184		0x102410f		e86c410000		CALL runtime.startTemplateThread(SB)		
  proc.go:185		0x1024114		488b0555bd0900		MOVQ __cgo_notify_runtime_init_done(SB), AX	
  proc.go:185		0x102411b		48890424		MOVQ AX, 0(SP)					
  proc.go:185		0x102411f		48c744240800000000	MOVQ $0x0, 0x8(SP)				
  proc.go:185		0x1024128		e863f0fdff		CALL runtime.cgocall(SB)			
  proc.go:189		0x102412d		488b05e4f10400		MOVQ go.func.*+495(SB), AX			
  proc.go:189		0x1024134		488d15ddf10400		LEAQ go.func.*+495(SB), DX			
  proc.go:189		0x102413b		ffd0			CALL AX						
  proc.go:190		0x102413d		488b05acbd0900		MOVQ runtime.main_init_done(SB), AX		
  proc.go:190		0x1024144		48890424		MOVQ AX, 0(SP)					
  proc.go:190		0x1024148		e83306feff		CALL runtime.closechan(SB)			
  proc.go:192		0x102414d		c644242700		MOVB $0x0, 0x27(SP)				
  proc.go:193		0x1024152		e859870000		CALL runtime.unlockOSThread(SB)			
  proc.go:195		0x1024157		488d052e810b00		LEAQ runtime.isarchive(SB), AX			
  proc.go:195		0x102415e		803800			CMPB $0x0, 0(AX)				
  proc.go:195		0x1024161		0f8590000000		JNE 0x10241f7					
  proc.go:195		0x1024167		488d0520810b00		LEAQ runtime.islibrary(SB), AX			
  proc.go:195		0x102416e		803800			CMPB $0x0, 0(AX)				
  proc.go:195		0x1024171		0f8580000000		JNE 0x10241f7					
  proc.go:201		0x1024177		488b05a2f10400		MOVQ go.func.*+503(SB), AX			
  proc.go:201		0x102417e		488d159bf10400		LEAQ go.func.*+503(SB), DX			
  proc.go:201		0x1024185		ffd0			CALL AX						
  proc.go:210		0x1024187		8b054f810b00		MOVL runtime.runningPanicDefers(SB), AX		
  proc.go:210		0x102418d		85c0			TESTL AX, AX					
  proc.go:210		0x102418f		7428			JE 0x10241b9					
  proc.go:210		0x1024191		31c0			XORL AX, AX					
  proc.go:212		0x1024193		eb12			JMP 0x10241a7					
  proc.go:212		0x1024195		4889442428		MOVQ AX, 0x28(SP)				
  proc.go:216		0x102419a		e8b1020000		CALL runtime.Gosched(SB)			
  proc.go:212		0x102419f		488b442428		MOVQ 0x28(SP), AX				
  proc.go:212		0x10241a4		48ffc0			INCQ AX						
  proc.go:212		0x10241a7		483de8030000		CMPQ $0x3e8, AX					
  proc.go:212		0x10241ad		7d0a			JGE 0x10241b9					
  proc.go:213		0x10241af		8b0d27810b00		MOVL runtime.runningPanicDefers(SB), CX		
  proc.go:213		0x10241b5		85c9			TESTL CX, CX					
  proc.go:213		0x10241b7		75dc			JNE 0x1024195					
  proc.go:219		0x10241b9		8b0515810b00		MOVL runtime.panicking(SB), AX			
  proc.go:219		0x10241bf		85c0			TESTL AX, AX					
  proc.go:219		0x10241c1		7516			JNE 0x10241d9					
  proc.go:223		0x10241c3		c7042400000000		MOVL $0x0, 0(SP)				
  proc.go:223		0x10241ca		e8e17a0100		CALL runtime.exit(SB)				
  proc.go:226		0x10241cf		31c0			XORL AX, AX					
  proc.go:226		0x10241d1		c70000000000		MOVL $0x0, 0(AX)				
  proc.go:226		0x10241d7		ebf6			JMP 0x10241cf					
  proc.go:220		0x10241d9		0f57c0			XORPS X0, X0					
  proc.go:220		0x10241dc		0f110424		MOVUPS X0, 0(SP)				
  proc.go:220		0x10241e0		66c74424100810		MOVW $0x1008, 0x10(SP)				
  proc.go:220		0x10241e7		48c744241801000000	MOVQ $0x1, 0x18(SP)				
  proc.go:220		0x10241f0		e88b020000		CALL runtime.gopark(SB)				
  proc.go:220		0x10241f5		ebcc			JMP 0x10241c3					
  proc.go:198		0x10241f7		90			NOPL						
  proc.go:198		0x10241f8		e8b3dbffff		CALL runtime.deferreturn(SB)			
  proc.go:198		0x10241fd		488b6c2438		MOVQ 0x38(SP), BP				
  proc.go:198		0x1024202		4883c440		ADDQ $0x40, SP					
  proc.go:198		0x1024206		c3			RET						
  proc.go:166		0x1024207		488d3de2bc0900		LEAQ runtime.main_init_done(SB), DI		
  proc.go:166		0x102420e		e86d5d0200		CALL runtime.gcWriteBarrier(SB)			
  proc.go:166		0x1024213		e9b3feffff		JMP 0x10240cb					
  proc.go:154		0x1024218		90			NOPL						
  proc.go:154		0x1024219		e892dbffff		CALL runtime.deferreturn(SB)			
  proc.go:154		0x102421e		488b6c2438		MOVQ 0x38(SP), BP				
  proc.go:154		0x1024223		4883c440		ADDQ $0x40, SP					
  proc.go:154		0x1024227		c3			RET						
  proc.go:180		0x1024228		488d0544df0400		LEAQ go.string.*+15603(SB), AX			
  proc.go:180		0x102422f		48890424		MOVQ AX, 0(SP)					
  proc.go:180		0x1024233		48c744240825000000	MOVQ $0x25, 0x8(SP)				
  proc.go:180		0x102423c		e85fe5ffff		CALL runtime.throw(SB)				
  proc.go:180		0x1024241		0f0b			UD2						
  proc.go:176		0x1024243		488d052ebb0400		LEAQ go.string.*+6392(SB), AX			
  proc.go:176		0x102424a		48890424		MOVQ AX, 0(SP)					
  proc.go:176		0x102424e		48c744240815000000	MOVQ $0x15, 0x8(SP)				
  proc.go:176		0x1024257		e844e5ffff		CALL runtime.throw(SB)				
  proc.go:176		0x102425c		0f0b			UD2						
  proc.go:173		0x102425e		488d05f3b50400		LEAQ go.string.*+5080(SB), AX			
  proc.go:173		0x1024265		48890424		MOVQ AX, 0(SP)					
  proc.go:173		0x1024269		48c744240813000000	MOVQ $0x13, 0x8(SP)				
  proc.go:173		0x1024272		e829e5ffff		CALL runtime.throw(SB)				
  proc.go:173		0x1024277		0f0b			UD2						
  proc.go:169		0x1024279		488d052bc40400		LEAQ go.string.*+8747(SB), AX			
  proc.go:169		0x1024280		48890424		MOVQ AX, 0(SP)					
  proc.go:169		0x1024284		48c744240819000000	MOVQ $0x19, 0x8(SP)				
  proc.go:169		0x102428d		e80ee5ffff		CALL runtime.throw(SB)				
  proc.go:169		0x1024292		0f0b			UD2						
  proc.go:149		0x1024294		488d05d9c00400		LEAQ go.string.*+7924(SB), AX			
  proc.go:149		0x102429b		48890424		MOVQ AX, 0(SP)					
  proc.go:149		0x102429f		48c744240817000000	MOVQ $0x17, 0x8(SP)				
  proc.go:149		0x10242a8		e8f3e4ffff		CALL runtime.throw(SB)				
  proc.go:149		0x10242ad		0f0b			UD2						
  proc.go:144		0x10242af		488d0547be0400		LEAQ go.string.*+7293(SB), AX			
  proc.go:144		0x10242b6		48890424		MOVQ AX, 0(SP)					
  proc.go:144		0x10242ba		48c744240816000000	MOVQ $0x16, 0x8(SP)				
  proc.go:144		0x10242c3		e8d8e4ffff		CALL runtime.throw(SB)				
  proc.go:144		0x10242c8		0f0b			UD2						
  proc.go:110		0x10242ca		e8d13e0200		CALL runtime.morestack_noctxt(SB)		
  proc.go:110		0x10242cf		e9acfcffff		JMP runtime.main(SB)				
  :-1			0x10242d4		cc			INT $0x3					
  :-1			0x10242d5		cc			INT $0x3					
  :-1			0x10242d6		cc			INT $0x3					
  :-1			0x10242d7		cc			INT $0x3					
  :-1			0x10242d8		cc			INT $0x3					
  :-1			0x10242d9		cc			INT $0x3					
  :-1			0x10242da		cc			INT $0x3					
  :-1			0x10242db		cc			INT $0x3					
  :-1			0x10242dc		cc			INT $0x3					
  :-1			0x10242dd		cc			INT $0x3					
  :-1			0x10242de		cc			INT $0x3					
  :-1			0x10242df		cc			INT $0x3					

TEXT runtime.main.func1(SB) /usr/local/Cellar/go/1.11/libexec/src/runtime/proc.go
  proc.go:130		0x10471f0		65488b0c2530000000	MOVQ GS:0x30, CX			
  proc.go:130		0x10471f9		483b6110		CMPQ 0x10(CX), SP			
  proc.go:130		0x10471fd		7631			JBE 0x1047230				
  proc.go:130		0x10471ff		4883ec18		SUBQ $0x18, SP				
  proc.go:130		0x1047203		48896c2410		MOVQ BP, 0x10(SP)			
  proc.go:130		0x1047208		488d6c2410		LEAQ 0x10(SP), BP			
  proc.go:131		0x104720d		488d05e4c20200		LEAQ go.func.*+975(SB), AX		
  proc.go:131		0x1047214		48890424		MOVQ AX, 0(SP)				
  proc.go:131		0x1047218		48c744240800000000	MOVQ $0x0, 0x8(SP)			
  proc.go:131		0x1047221		e8ca0dfeff		CALL runtime.newm(SB)			
  proc.go:132		0x1047226		488b6c2410		MOVQ 0x10(SP), BP			
  proc.go:132		0x104722b		4883c418		ADDQ $0x18, SP				
  proc.go:132		0x104722f		c3			RET					
  proc.go:130		0x1047230		e86b0f0000		CALL runtime.morestack_noctxt(SB)	
  proc.go:130		0x1047235		ebb9			JMP runtime.main.func1(SB)		
  :-1			0x1047237		cc			INT $0x3				
  :-1			0x1047238		cc			INT $0x3				
  :-1			0x1047239		cc			INT $0x3				
  :-1			0x104723a		cc			INT $0x3				
  :-1			0x104723b		cc			INT $0x3				
  :-1			0x104723c		cc			INT $0x3				
  :-1			0x104723d		cc			INT $0x3				
  :-1			0x104723e		cc			INT $0x3				
  :-1			0x104723f		cc			INT $0x3				

TEXT runtime.main.func2(SB) /usr/local/Cellar/go/1.11/libexec/src/runtime/proc.go
  proc.go:154		0x1047240		65488b0c2530000000	MOVQ GS:0x30, CX			
  proc.go:154		0x1047249		483b6110		CMPQ 0x10(CX), SP			
  proc.go:154		0x104724d		7626			JBE 0x1047275				
  proc.go:154		0x104724f		4883ec08		SUBQ $0x8, SP				
  proc.go:154		0x1047253		48892c24		MOVQ BP, 0(SP)				
  proc.go:154		0x1047257		488d2c24		LEAQ 0(SP), BP				
  proc.go:155		0x104725b		488b442410		MOVQ 0x10(SP), AX			
  proc.go:155		0x1047260		803800			CMPB $0x0, 0(AX)			
  proc.go:155		0x1047263		7509			JNE 0x104726e				
  proc.go:155		0x1047265		488b2c24		MOVQ 0(SP), BP				
  proc.go:155		0x1047269		4883c408		ADDQ $0x8, SP				
  proc.go:155		0x104726d		c3			RET					
  proc.go:156		0x104726e		e83d56feff		CALL runtime.unlockOSThread(SB)		
  proc.go:156		0x1047273		ebf0			JMP 0x1047265				
  proc.go:154		0x1047275		e8260f0000		CALL runtime.morestack_noctxt(SB)	
  proc.go:154		0x104727a		ebc4			JMP runtime.main.func2(SB)		
  :-1			0x104727c		cc			INT $0x3				
  :-1			0x104727d		cc			INT $0x3				
  :-1			0x104727e		cc			INT $0x3				
  :-1			0x104727f		cc			INT $0x3				

TEXT main.longcall(SB) /Users/changkun/dev/go-under-the-hood/demo/4-sched/peer/main.go
  main.go:5		0x10508d0		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:5		0x10508d9		483b6110		CMPQ 0x10(CX), SP			
  main.go:5		0x10508dd		7623			JBE 0x1050902				
  main.go:5		0x10508df		4883ec10		SUBQ $0x10, SP				
  main.go:5		0x10508e3		48896c2408		MOVQ BP, 0x8(SP)			
  main.go:5		0x10508e8		488d6c2408		LEAQ 0x8(SP), BP			
  main.go:6		0x10508ed		eb00			JMP 0x10508ef				
  main.go:7		0x10508ef		eb00			JMP 0x10508f1				
  main.go:7		0x10508f1		48c7042400ca9a3b	MOVQ $0x3b9aca00, 0(SP)			
  main.go:7		0x10508f9		e882bcfeff		CALL time.Sleep(SB)			
  main.go:7		0x10508fe		eb00			JMP 0x1050900				
  main.go:7		0x1050900		ebed			JMP 0x10508ef				
  main.go:5		0x1050902		e89978ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:5		0x1050907		ebc7			JMP main.longcall(SB)			
  :-1			0x1050909		cc			INT $0x3				
  :-1			0x105090a		cc			INT $0x3				
  :-1			0x105090b		cc			INT $0x3				
  :-1			0x105090c		cc			INT $0x3				
  :-1			0x105090d		cc			INT $0x3				
  :-1			0x105090e		cc			INT $0x3				
  :-1			0x105090f		cc			INT $0x3				

TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/4-sched/peer/main.go
  main.go:11		0x1050910		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:11		0x1050919		483b6110		CMPQ 0x10(CX), SP			
  main.go:11		0x105091d		763b			JBE 0x105095a				
  main.go:11		0x105091f		4883ec18		SUBQ $0x18, SP				
  main.go:11		0x1050923		48896c2410		MOVQ BP, 0x10(SP)			
  main.go:11		0x1050928		488d6c2410		LEAQ 0x10(SP), BP			
  main.go:12		0x105092d		c7042400000000		MOVL $0x0, 0(SP)			
  main.go:12		0x1050934		488d053d280200		LEAQ go.func.*+79(SB), AX		
  main.go:12		0x105093b		4889442408		MOVQ AX, 0x8(SP)			
  main.go:12		0x1050940		e81bb1fdff		CALL runtime.newproc(SB)		
  main.go:14		0x1050945		eb00			JMP 0x1050947				
  main.go:15		0x1050947		eb00			JMP 0x1050949				
  main.go:15		0x1050949		48c7042400ca9a3b	MOVQ $0x3b9aca00, 0(SP)			
  main.go:15		0x1050951		e82abcfeff		CALL time.Sleep(SB)			
  main.go:15		0x1050956		eb00			JMP 0x1050958				
  main.go:15		0x1050958		ebed			JMP 0x1050947				
  main.go:11		0x105095a		e84178ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:11		0x105095f		ebaf			JMP main.main(SB)			
  :-1			0x1050961		cc			INT $0x3				
  :-1			0x1050962		cc			INT $0x3				
  :-1			0x1050963		cc			INT $0x3				
  :-1			0x1050964		cc			INT $0x3				
  :-1			0x1050965		cc			INT $0x3				
  :-1			0x1050966		cc			INT $0x3				
  :-1			0x1050967		cc			INT $0x3				
  :-1			0x1050968		cc			INT $0x3				
  :-1			0x1050969		cc			INT $0x3				
  :-1			0x105096a		cc			INT $0x3				
  :-1			0x105096b		cc			INT $0x3				
  :-1			0x105096c		cc			INT $0x3				
  :-1			0x105096d		cc			INT $0x3				
  :-1			0x105096e		cc			INT $0x3				
  :-1			0x105096f		cc			INT $0x3				

TEXT main.init(SB) <autogenerated>
  <autogenerated>:1	0x1050970		65488b0c2530000000	MOVQ GS:0x30, CX			
  <autogenerated>:1	0x1050979		483b6110		CMPQ 0x10(CX), SP			
  <autogenerated>:1	0x105097d		764e			JBE 0x10509cd				
  <autogenerated>:1	0x105097f		4883ec08		SUBQ $0x8, SP				
  <autogenerated>:1	0x1050983		48892c24		MOVQ BP, 0(SP)				
  <autogenerated>:1	0x1050987		488d2c24		LEAQ 0(SP), BP				
  <autogenerated>:1	0x105098b		803df0b8080001		CMPB $0x1, main.initdone.(SB)		
  <autogenerated>:1	0x1050992		7702			JA 0x1050996				
  <autogenerated>:1	0x1050994		eb09			JMP 0x105099f				
  <autogenerated>:1	0x1050996		488b2c24		MOVQ 0(SP), BP				
  <autogenerated>:1	0x105099a		4883c408		ADDQ $0x8, SP				
  <autogenerated>:1	0x105099e		c3			RET					
  <autogenerated>:1	0x105099f		803ddcb8080001		CMPB $0x1, main.initdone.(SB)		
  <autogenerated>:1	0x10509a6		7402			JE 0x10509aa				
  <autogenerated>:1	0x10509a8		eb07			JMP 0x10509b1				
  <autogenerated>:1	0x10509aa		e8410bfdff		CALL runtime.throwinit(SB)		
  <autogenerated>:1	0x10509af		0f0b			UD2					
  <autogenerated>:1	0x10509b1		c605cab8080001		MOVB $0x1, main.initdone.(SB)		
  <autogenerated>:1	0x10509b8		e883faffff		CALL time.init(SB)			
  <autogenerated>:1	0x10509bd		c605beb8080002		MOVB $0x2, main.initdone.(SB)		
  <autogenerated>:1	0x10509c4		488b2c24		MOVQ 0(SP), BP				
  <autogenerated>:1	0x10509c8		4883c408		ADDQ $0x8, SP				
  <autogenerated>:1	0x10509cc		c3			RET					
  <autogenerated>:1	0x10509cd		e8ce77ffff		CALL runtime.morestack_noctxt(SB)	
  <autogenerated>:1	0x10509d2		eb9c			JMP main.init(SB)			
